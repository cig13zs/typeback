import type { FieldSignature } from './types';
import { isContentEditableHost, isSavableField } from './sensitive';

const DYNAMIC_ID = [
  /^:r/i,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  /^(?:ember\d+|ui-id-\d+|react-select-\d+|ext-gen\d+|mui-\d+)/i,
  /[0-9a-f]{16,}/i,
  /[_-][0-9a-f]{6,}$/i,
];

export function isStableDomId(id: string | null | undefined): id is string {
  if (!id) return false;
  if (id.length > 64) return false;
  if (DYNAMIC_ID.some((pattern) => pattern.test(id))) return false;
  if (/^\d+$/.test(id)) return false;
  return true;
}

function clip(value: string, max = 80): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? collapsed.slice(0, max) : collapsed;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function rootOf(el: Element): ParentNode {
  const root = el.getRootNode();
  if (root instanceof Document || root instanceof ShadowRoot) return root;
  return el.ownerDocument;
}

function byId(root: ParentNode, id: string): Element | null {
  if (root instanceof Document || root instanceof ShadowRoot) return root.getElementById(id);
  return null;
}

function labelFromFor(el: Element): string {
  const id = el.getAttribute('id');
  if (!id) return '';
  const label = rootOf(el).querySelector(`label[for="${cssEscape(id)}"]`);
  return label ? clip(label.textContent || '') : '';
}

function labelFromWrapping(el: Element): string {
  const label = el.closest('label');
  if (!label) return '';
  const clone = label.cloneNode(true);
  if (clone instanceof Element) {
    clone.querySelectorAll('input, textarea, select, button').forEach((node) => node.remove());
    return clip(clone.textContent || '');
  }
  return '';
}

function labelFromAria(el: Element): string {
  const direct = clip(el.getAttribute('aria-label') || '');
  if (direct) return direct;
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return '';
  const root = rootOf(el);
  const parts: string[] = [];
  for (const id of ids.split(/\s+/)) {
    if (!id) continue;
    const node = byId(root, id);
    if (node?.textContent) parts.push(node.textContent);
  }
  return clip(parts.join(' '));
}

function humanLabel(el: Element): string {
  const aria = labelFromAria(el);
  if (aria) return aria;
  const associated = labelFromFor(el) || labelFromWrapping(el);
  if (associated) return associated;
  const placeholder =
    el.getAttribute('placeholder') ||
    el.getAttribute('data-placeholder') ||
    el.getAttribute('aria-placeholder') ||
    '';
  if (placeholder.trim()) return clip(placeholder);
  const name = el.getAttribute('name');
  if (name) return clip(name);
  const id = el.getAttribute('id');
  if (isStableDomId(id)) return clip(id);
  if (el instanceof HTMLTextAreaElement) return 'Text area';
  if (el instanceof HTMLInputElement) return 'Text field';
  if (isContentEditableHost(el)) return 'Editable text';
  return el.tagName.toLowerCase();
}

function formToken(el: Element): string {
  const form = el.closest('form');
  if (!form) return '';
  if (isStableDomId(form.id)) return `form:${form.id}`;
  const name = form.getAttribute('name');
  if (name) return `form:${clip(name, 40)}`;
  const action = form.getAttribute('action');
  if (!action) return '';
  try {
    const path = new URL(action, 'https://typeback.local').pathname;
    return `action:${clip(path, 60)}`;
  } catch {
    return '';
  }
}

function baseKey(el: Element, label: string): string {
  const tag = el.tagName.toLowerCase();
  const type = el instanceof HTMLInputElement
    ? (el.getAttribute('type') || 'text').toLowerCase()
    : isContentEditableHost(el)
      ? 'contenteditable'
      : tag;
  const parts = [`tag:${tag}`, `type:${type}`];
  const name = el.getAttribute('name');
  if (name) parts.push(`name:${clip(name, 60)}`);
  const id = el.getAttribute('id');
  if (isStableDomId(id)) parts.push(`id:${id}`);
  const autocomplete = el.getAttribute('autocomplete');
  if (autocomplete) parts.push(`ac:${autocomplete.toLowerCase()}`);
  const form = formToken(el);
  if (form) parts.push(form);
  parts.push(`label:${label.toLowerCase()}`);
  return parts.join('|');
}

function peers(el: Element): Element[] {
  const found: Element[] = [];
  rootOf(el).querySelectorAll('input, textarea, [contenteditable]').forEach((node) => {
    if (isSavableField(node)) found.push(node);
  });
  return found;
}

export function identifyField(el: Element): FieldSignature {
  const label = humanLabel(el);
  const key = baseKey(el, label);
  const same = peers(el).filter((other) => baseKey(other, humanLabel(other)) === key);
  if (same.length <= 1) return { fieldKey: key, label };
  const index = Math.max(0, same.indexOf(el));
  return { fieldKey: `${key}|n:${index}`, label };
}
