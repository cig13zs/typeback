function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const prototype = Object.getPrototypeOf(el) as object;
  const descriptor =
    Object.getOwnPropertyDescriptor(prototype, 'value') ??
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(prototype) as object, 'value');
  if (descriptor?.set) descriptor.set.call(el, text);
  else el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function readFieldText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  if (typeof el.innerText === 'string' && el.innerText.length > 0) return el.innerText;
  return el.textContent ?? '';
}

function writeContentEditable(el: HTMLElement, text: string): void {
  el.focus();
  const selection = el.ownerDocument.getSelection?.() ?? null;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  selection?.removeAllRanges();
  selection?.addRange(range);
  let inserted: boolean;
  try {
    inserted = el.ownerDocument.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }
  const current = readFieldText(el).replace(/\s+/g, ' ').trim();
  const expected = text.replace(/\s+/g, ' ').trim();
  if (!inserted || current !== expected) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
}

/** Writes text in a way React-style controlled fields notice. */
export function writeFieldText(el: HTMLElement, text: string): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, text);
    return;
  }
  writeContentEditable(el, text);
}
