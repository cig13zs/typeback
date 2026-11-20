# Typeback privacy

Typeback recovers text you typed into web forms. That is the whole product. It is local-first: drafts, settings, and the optional encryption header are stored in Chrome on your device. The extension does not phone home. It has no account, no analytics, no remote fonts, and no remote code.

## What is stored on this device

For each saved field:

- The text you typed, plus a short history of earlier versions (ten by default).
- The site origin and a normalized page URL (tracking parameters and the hash are dropped) so the draft can be offered again on that page.
- A field identity and a human label (the accessible name, placeholder, or field name) so the right box is restored.
- Timestamps, a pin flag, and, when encryption is on, ciphertext instead of the text.

When encryption is on, the stored record is AES-GCM ciphertext. The key is derived with PBKDF2-SHA-256 (210,000 iterations) from a passphrase you choose. A random salt and a verifier are stored so Typeback can tell a wrong passphrase from a right one. The passphrase itself is never written to disk. After you unlock, it is held in `chrome.storage.session`, which Chrome keeps in memory and clears when the browser quits.

If you forget the passphrase, Typeback cannot read those drafts. There is no recovery server.

## What is never saved

- Password fields, including `autocomplete="current-password"` and `autocomplete="new-password"`.
- Hidden fields, and fields marked `hidden` or `aria-hidden="true"`.
- Credit-card fields (`autocomplete` tokens starting with `cc-`).
- One-time codes (`autocomplete="one-time-code"`, and names that look like OTP, PIN, CVV, SSN, or an account number).
- Fields with `data-typeback="off"`.
- Sites on your blocklist. Banking and payment domains are on that list until you remove them.
- Anything typed while Typeback is paused.

The extension does not read Chrome’s password store and does not ask for the `tabs` permission (browsing history).

## What leaves the device

Nothing the extension collects is transmitted to the author or to any server. Export writes a JSON file you choose to download. That file does not contain the passphrase. Import reads a file you pick.

Chrome itself may sync extension storage if you have turned on Chrome Sync for extensions. That is a browser setting, not a Typeback feature. If you do not want drafts in Chrome Sync, turn encryption on, or turn off extension sync in Chrome.

## Retention

Unpinned drafts older than the retention period (7 days by default) are deleted on a schedule and when you open the popup. Pinned drafts stay until you delete them. You can export a backup first.

## Permissions

They are listed in the [README](README.md#permissions). Each one is required for the single purpose of the extension: recovering text you typed into forms on this device.
