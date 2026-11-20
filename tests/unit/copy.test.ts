import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import copy from '../../src/copy.json';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const listing = readFileSync(new URL('../../STORE_LISTING.md', import.meta.url), 'utf8');
const privacy = readFileSync(new URL('../../PRIVACY.md', import.meta.url), 'utf8');
const build = readFileSync(new URL('../../scripts/build.mjs', import.meta.url), 'utf8');

describe('store copy', () => {
  it('keeps the Chrome Web Store title and a short description within 132 characters', () => {
    expect(copy.storeName).toBe('Typeback: Recover Lost Form Text');
    expect(copy.shortDescription.length).toBeLessThanOrEqual(132);
    expect(copy.shortDescription).toBe(
      'Lost a long comment or email to a crash or closed tab? Typeback saves what you type and brings it back. Private, no passwords.',
    );
    expect(copy.restoreMenu).toBe('Restore typed text…');
  });

  it('uses that wording in the README, the listing, and the manifest build', () => {
    for (const doc of [readme, listing]) {
      expect(doc).toContain(copy.storeName);
      expect(doc).toContain(copy.shortDescription);
    }
    expect(listing).toContain(copy.restoreMenu);
    expect(privacy).toContain('Typeback');
    expect(build).toContain('copy.json');
    expect(build).toContain("permissions: ['storage', 'contextMenus', 'alarms']");
  });
});
