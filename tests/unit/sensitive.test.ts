// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findEditable } from '../../src/lib/editable';
import { hasSensitiveAutocomplete, isSavableField, isSensitiveField, sensitiveReason } from '../../src/lib/sensitive';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  const el = document.body.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error('missing element');
  return el;
}

describe('sensitive fields', () => {
  it('rejects password, hidden, and one-time-code fields', () => {
    expect(sensitiveReason(mount('<input type="password" name="x">'))).toBe('password');
    expect(sensitiveReason(mount('<input type="hidden" name="token">'))).toBe('hidden');
    expect(sensitiveReason(mount('<textarea hidden>note</textarea>'))).toBe('hidden');
    expect(sensitiveReason(mount('<input type="text" autocomplete="one-time-code">'))).toBe('autocomplete');
    expect(sensitiveReason(mount('<input type="text" autocomplete="new-password">'))).toBe('autocomplete');
    expect(sensitiveReason(mount('<input type="text" autocomplete="current-password">'))).toBe('autocomplete');
    expect(sensitiveReason(mount('<input type="text" autocomplete="section-billing cc-number">'))).toBe('autocomplete');
    expect(sensitiveReason(mount('<input type="text" autocomplete="cc-csc">'))).toBe('autocomplete');
    expect(sensitiveReason(mount('<input type="text" name="otp">'))).toBe('name');
    expect(sensitiveReason(mount('<input type="text" id="card-number">'))).toBe('name');
    expect(sensitiveReason(mount('<input type="text" aria-label="Social security number">'))).toBe('name');
    expect(sensitiveReason(mount('<div contenteditable="true" aria-label="One-time code"></div>'))).toBe('name');
    expect(isSensitiveField(mount('<input data-typeback="off" type="text">'))).toBe(true);
  });

  it('keeps ordinary text, email, search, and contenteditable fields', () => {
    expect(isSavableField(mount('<textarea name="comment"></textarea>'))).toBe(true);
    expect(isSavableField(mount('<input type="email" name="email" autocomplete="email">'))).toBe(true);
    expect(isSavableField(mount('<input type="search" placeholder="Search">'))).toBe(true);
    expect(isSavableField(mount('<div contenteditable="true" aria-label="Message body"></div>'))).toBe(true);
    expect(isSensitiveField(mount('<textarea id="description"></textarea>'))).toBe(false);
  });

  it('does not save checkboxes, files, or readonly fields', () => {
    expect(isSavableField(mount('<input type="checkbox">'))).toBe(false);
    expect(isSensitiveField(mount('<input type="checkbox">'))).toBe(false);
    expect(isSavableField(mount('<input type="file">'))).toBe(false);
    expect(isSavableField(mount('<textarea readonly></textarea>'))).toBe(false);
  });

  it('detects cc-* autocomplete tokens among other tokens', () => {
    expect(hasSensitiveAutocomplete('shipping cc-name')).toBe(true);
    expect(hasSensitiveAutocomplete('email')).toBe(false);
    expect(hasSensitiveAutocomplete(null)).toBe(false);
  });

  it('finds the editable host and skips secrets', () => {
    document.body.innerHTML = '<div contenteditable="true" aria-label="Body"><p id="p">hi</p></div>';
    expect(findEditable(document.querySelector('#p'))).toBe(document.querySelector('[contenteditable]'));
    document.body.innerHTML = '<input type="password" id="pw">';
    expect(findEditable(document.querySelector('#pw'))).toBeNull();
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const area = document.createElement('textarea');
    area.setAttribute('aria-label', 'Reply');
    shadow.append(area);
    expect(findEditable(area)).toBe(area);
  });
});
