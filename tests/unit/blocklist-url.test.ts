import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOCKLIST, hostBlocked, parseBlocklist } from '../../src/lib/blocklist';
import { pageKey } from '../../src/lib/url';

describe('blocklist', () => {
  it('blocks banking hosts and their subdomains, not lookalikes', () => {
    expect(DEFAULT_BLOCKLIST).toContain('chase.com');
    expect(hostBlocked('www.chase.com', DEFAULT_BLOCKLIST)).toBe(true);
    expect(hostBlocked('chase.com', DEFAULT_BLOCKLIST)).toBe(true);
    expect(hostBlocked('notchase.com', DEFAULT_BLOCKLIST)).toBe(false);
    expect(hostBlocked('example.com', DEFAULT_BLOCKLIST)).toBe(false);
  });

  it('normalizes pasted URLs and blank lines', () => {
    expect(parseBlocklist(' \nhttps://PayPal.com/login\n*.Chase.com\n\npaypal.com\n')).toEqual([
      'paypal.com',
      'chase.com',
    ]);
  });
});

describe('page keys', () => {
  it('drops hashes and tracking params and ignores a trailing slash', () => {
    const left = pageKey('https://Example.com/mail/u/0/?utm_source=ad&b=2&a=1#inbox');
    const right = pageKey('https://example.com/mail/u/0?a=1&b=2');
    expect(left).toEqual(right);
    expect(left?.urlKey).toBe('/mail/u/0?a=1&b=2');
    expect(pageKey('file:///tmp/note') ).toBeNull();
  });
});
