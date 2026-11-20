// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { identifyField, isStableDomId } from '../../src/lib/field-identity';
import { writeFieldText } from '../../src/lib/field-value';

describe('field identity', () => {
  it('ignores generated ids and stays stable for the same field', () => {
    document.body.innerHTML = '<form id="composer"><label for=":r1:">Title</label><input id=":r1:" name="title"></form>';
    const first = identifyField(document.querySelector('input') as HTMLInputElement);
    document.body.innerHTML = '<form id="composer"><label for=":r9:">Title</label><input id=":r9:" name="title"></form>';
    const second = identifyField(document.querySelector('input') as HTMLInputElement);
    expect(first.fieldKey).toBe(second.fieldKey);
    expect(first.fieldKey).not.toContain(':r');
    expect(first.fieldKey).toContain('name:title');
    expect(first.fieldKey).toContain('form:composer');
    expect(first.label).toBe('Title');
    expect(isStableDomId(':r1:')).toBe(false);
    expect(isStableDomId('comment')).toBe(true);
  });

  it('separates fields that share a name when their labels differ', () => {
    document.body.innerHTML = `
      <input name="qty" aria-label="Adults">
      <input name="qty" aria-label="Children">
    `;
    const [adults, children] = [...document.querySelectorAll('input')].map((el) => identifyField(el));
    expect(adults?.fieldKey).not.toBe(children?.fieldKey);
    expect(adults?.label).toBe('Adults');
    expect(children?.label).toBe('Children');
  });

  it('disambiguates identical unlabeled fields by position', () => {
    document.body.innerHTML = '<textarea></textarea><textarea></textarea>';
    const [first, second] = [...document.querySelectorAll('textarea')].map((el) => identifyField(el).fieldKey);
    expect(first).not.toBe(second);
    expect(first).toContain('n:0');
    expect(second).toContain('n:1');
    expect(identifyField(document.querySelector('textarea') as HTMLTextAreaElement).fieldKey).toBe(first);
  });

  it('does not let the current value leak into a wrapping label', () => {
    document.body.innerHTML = '<label>Comment <textarea name="comment">secret draft</textarea></label>';
    const signature = identifyField(document.querySelector('textarea') as HTMLTextAreaElement);
    expect(signature.label).toBe('Comment');
    expect(signature.fieldKey).not.toContain('secret');
  });

  it('names contenteditable editors from their accessible name, including open shadow roots', () => {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div contenteditable="true" aria-label="Message body"></div>';
    const signature = identifyField(shadow.querySelector('[contenteditable]') as HTMLElement);
    expect(signature.label).toBe('Message body');
    expect(signature.fieldKey).toContain('contenteditable');
  });
});

describe('writing a field', () => {
  it('sets a textarea value through the prototype so listeners see it', () => {
    document.body.innerHTML = '<textarea id="comment"></textarea>';
    const area = document.querySelector('#comment') as HTMLTextAreaElement;
    let seen = '';
    area.addEventListener('input', () => {
      seen = area.value;
    });
    writeFieldText(area, 'brought back');
    expect(area.value).toBe('brought back');
    expect(seen).toBe('brought back');
  });
});
