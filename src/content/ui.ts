import copy from '../copy.json';
import { previewText, timeAgo } from '../lib/format';

export interface RestoreChoice {
  text: string;
  savedAt: number;
  latest: boolean;
}

const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap {
    pointer-events: auto;
    font-family: "Segoe UI", "Avenir Next", "Helvetica Neue", sans-serif;
    color: #1c2430;
  }
  .chip, .note {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid #d9d0c2;
    background: #fffaf3;
    color: #1f4d45;
    border-radius: 999px;
    padding: 5px 11px 5px 8px;
    font: 600 12.5px/1.2 "Segoe UI", "Avenir Next", sans-serif;
    box-shadow: 0 8px 24px rgba(28, 36, 48, 0.16);
    cursor: pointer;
  }
  .note { cursor: default; color: #5e675f; font-weight: 500; max-width: 280px; }
  .mark {
    width: 16px; height: 16px; border-radius: 5px; background: #1f4d45; color: #f6f1e7;
    display: inline-grid; place-items: center; flex: none;
  }
  .mark svg { display: block; }
  .panel {
    width: 300px;
    max-height: 320px;
    overflow: auto;
    background: #fffaf3;
    border: 1px solid #e1d9cc;
    border-radius: 14px;
    box-shadow: 0 16px 40px rgba(28, 36, 48, 0.18);
    padding: 8px;
  }
  .panel h2 {
    margin: 4px 8px 8px;
    font: 600 13px/1.3 "Iowan Old Style", Palatino, Georgia, serif;
    color: #1f4d45;
  }
  .choice {
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    border-radius: 10px;
    background: transparent;
    padding: 8px;
    cursor: pointer;
    font: 400 13px/1.35 "Segoe UI", sans-serif;
    color: #1c2430;
  }
  .choice:hover, .choice:focus-visible { background: #f3efe6; outline: none; }
  .meta { display: block; color: #1f4d45; font-size: 11px; font-weight: 650; letter-spacing: 0.02em; }
  .snippet {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: #3c4652;
    margin-top: 2px;
    white-space: normal;
  }
  [hidden] { display: none !important; }
`;

function markSvg(): string {
  return `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M11 8H6.2" stroke="#F6F1E7" stroke-width="1.8" stroke-linecap="round"/><path d="M8 5.2 5.2 8 8 10.8" fill="none" stroke="#F6F1E7" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export class RestoreUi {
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly chip: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private anchor: HTMLElement | null = null;
  private choices: RestoreChoice[] = [];
  private onPick: ((text: string) => void) | null = null;
  private onChip: (() => void) | null = null;
  private placed = false;
  private noteTimer = 0;

  constructor(doc: Document) {
    this.host = doc.createElement('div');
    this.host.id = 'typeback-root';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      <style>${CSS}</style>
      <div class="wrap">
        <button type="button" class="chip" hidden></button>
        <div class="note" hidden></div>
        <div class="panel" role="dialog" aria-label="${copy.chipLabel}" hidden>
          <h2>${copy.chipLabel}</h2>
          <div class="list"></div>
        </div>
      </div>
    `;
    this.chip = this.shadow.querySelector('.chip') as HTMLButtonElement;
    this.panel = this.shadow.querySelector('.panel') as HTMLDivElement;
    this.list = this.shadow.querySelector('.list') as HTMLDivElement;
    this.note = this.shadow.querySelector('.note') as HTMLDivElement;
    this.chip.innerHTML = `<span class="mark">${markSvg()}</span><span class="label"></span>`;
    this.setHostStyle();
    doc.documentElement.append(this.host);
    this.shadow.addEventListener('mousedown', (event) => event.preventDefault());
    this.chip.addEventListener('click', () => this.onChip?.());
    this.list.addEventListener('click', (event) => {
      const button = (event.target as Element | null)?.closest('button');
      if (!(button instanceof HTMLButtonElement)) return;
      const index = Number(button.dataset.index);
      const choice = this.choices[index];
      if (!choice || !this.onPick) return;
      const pick = this.onPick;
      this.hide();
      pick(choice.text);
    });
    this.onKey = this.onKey.bind(this);
    this.onMove = this.onMove.bind(this);
  }

  containsTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    return this.shadow.contains(target) || this.host.contains(target);
  }

  showChip(anchor: HTMLElement, label: string, onClick: () => void): void {
    this.clearNoteTimer();
    this.anchor = anchor;
    this.onChip = onClick;
    this.onPick = null;
    this.panel.hidden = true;
    this.note.hidden = true;
    const text = this.chip.querySelector('.label');
    if (text) text.textContent = label;
    this.chip.hidden = false;
    this.mountListeners();
    this.place();
  }

  openPanel(anchor: HTMLElement, choices: RestoreChoice[], onPick: (text: string) => void): void {
    this.clearNoteTimer();
    this.anchor = anchor;
    this.choices = choices;
    this.onPick = onPick;
    this.chip.hidden = true;
    this.note.hidden = true;
    this.list.replaceChildren();
    choices.forEach((choice, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice';
      button.dataset.index = String(index);
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${choice.latest ? 'Latest' : 'Earlier'} · ${timeAgo(choice.savedAt)}`;
      const snippet = document.createElement('span');
      snippet.className = 'snippet';
      snippet.textContent = previewText(choice.text, 180);
      button.append(meta, snippet);
      this.list.append(button);
    });
    this.panel.hidden = false;
    this.mountListeners();
    this.place();
    const first = this.list.querySelector('button');
    if (first instanceof HTMLButtonElement) first.focus();
  }

  showNote(anchor: HTMLElement | null, message: string): void {
    this.anchor = anchor;
    this.chip.hidden = true;
    this.panel.hidden = true;
    this.note.hidden = false;
    this.note.textContent = message;
    this.mountListeners();
    this.place();
    this.clearNoteTimer();
    this.noteTimer = window.setTimeout(() => this.hide(), 3600);
  }

  hide(): void {
    this.clearNoteTimer();
    this.chip.hidden = true;
    this.panel.hidden = true;
    this.note.hidden = true;
    this.unmountListeners();
  }

  isPanelOpen(): boolean {
    return !this.panel.hidden;
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.hide();
      return;
    }
    if (this.panel.hidden) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...this.list.querySelectorAll('button')];
    if (buttons.length === 0) return;
    event.preventDefault();
    const current = this.shadow.activeElement;
    let index = buttons.findIndex((button) => button === current);
    index = event.key === 'ArrowDown' ? index + 1 : index - 1;
    if (index < 0) index = buttons.length - 1;
    if (index >= buttons.length) index = 0;
    buttons[index]?.focus();
  }

  private onMove(): void {
    if (!this.placed) return;
    this.place();
  }

  private mountListeners(): void {
    if (this.placed) return;
    this.placed = true;
    window.addEventListener('scroll', this.onMove, true);
    window.addEventListener('resize', this.onMove);
    document.addEventListener('keydown', this.onKey, true);
  }

  private unmountListeners(): void {
    if (!this.placed) return;
    this.placed = false;
    window.removeEventListener('scroll', this.onMove, true);
    window.removeEventListener('resize', this.onMove);
    document.removeEventListener('keydown', this.onKey, true);
  }

  private place(): void {
    const anchor = this.anchor;
    if (!anchor || !anchor.isConnected) {
      this.host.style.setProperty('top', '16px', 'important');
      this.host.style.setProperty('left', '16px', 'important');
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 16);
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    this.host.style.setProperty('left', `${Math.round(left)}px`, 'important');
    this.host.style.setProperty('top', `${Math.round(rect.bottom + 8)}px`, 'important');
    const height = this.host.getBoundingClientRect().height;
    if (rect.bottom + 8 + height > window.innerHeight - 8) {
      const top = Math.max(8, rect.top - height - 8);
      this.host.style.setProperty('top', `${Math.round(top)}px`, 'important');
    }
  }

  private setHostStyle(): void {
    const style: Record<string, string> = {
      position: 'fixed',
      'z-index': '2147483646',
      top: '0',
      left: '0',
      margin: '0',
      padding: '0',
      border: 'none',
      background: 'transparent',
      display: 'block',
      width: 'max-content',
      'max-width': '320px',
      'pointer-events': 'none',
    };
    for (const [key, value] of Object.entries(style)) {
      this.host.style.setProperty(key, value, 'important');
    }
  }

  private clearNoteTimer(): void {
    if (this.noteTimer) window.clearTimeout(this.noteTimer);
    this.noteTimer = 0;
  }
}
