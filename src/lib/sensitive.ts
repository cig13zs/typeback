const SAVABLE_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number']);

const SECRET_TEXT: readonly RegExp[] = [
  /pass(?:word|wd|phrase)/i,
  /credit[\s_-]?card/i,
  /card[\s_-]?(?:number|num|no)\b/i,
  /cc[\s_-]?(?:number|num|name|exp|csc|cvc)/i,
  /(?:^|[^a-z0-9])(?:cvv|cvc|ccv|csc)(?:[^a-z0-9]|$)/i,
  /(?:^|[^a-z0-9])(?:ssn|otp|pin)(?:[^a-z0-9]|$)/i,
  /social[\s_-]?security/i,
  /one[\s_-]?time[\s_-]?(?:code|password)/i,
  /verification[\s_-]?code/i,
  /security[\s_-]?code/i,
  /routing[\s_-]?number/i,
  /account[\s_-]?number/i,
];

export type SensitiveReason = 'ignored' | 'password' | 'hidden' | 'autocomplete' | 'name';

/** Any autocomplete token of cc-*, one-time-code, new-password, or current-password. */
export function hasSensitiveAutocomplete(value: string | null | undefined): boolean {
  if (!value) return false;
  for (const token of value.toLowerCase().split(/\s+/)) {
    if (!token) continue;
    if (token.startsWith('cc-')) return true;
    if (token === 'one-time-code' || token === 'new-password' || token === 'current-password') {
      return true;
    }
  }
  return false;
}

function haystack(el: Element): string {
  return [
    el.getAttribute('name'),
    el.getAttribute('id'),
    el.getAttribute('aria-label'),
    el.getAttribute('placeholder'),
    el.getAttribute('title'),
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

export function sensitiveReason(el: Element): SensitiveReason | null {
  if (el.getAttribute('data-typeback') === 'off') return 'ignored';
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'password') return 'password';
  if (type === 'hidden' || el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
    return 'hidden';
  }
  if (hasSensitiveAutocomplete(el.getAttribute('autocomplete'))) return 'autocomplete';
  const text = haystack(el);
  if (text && SECRET_TEXT.some((pattern) => pattern.test(text))) return 'name';
  return null;
}

export function isSensitiveField(el: Element): boolean {
  return sensitiveReason(el) !== null;
}

export function isContentEditableHost(el: Element): boolean {
  const attr = el.getAttribute('contenteditable');
  if (attr === null) return false;
  return attr.trim().toLowerCase() !== 'false';
}

export function isSavableField(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.hasAttribute('readonly') || el.getAttribute('aria-readonly') === 'true') return false;
  if (isSensitiveField(el)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return SAVABLE_INPUT_TYPES.has(type);
  }
  return isContentEditableHost(el);
}
