# Chrome Web Store listing

## Name

Typeback: Recover Lost Form Text

## Short description

Lost a long comment or email to a crash or closed tab? Typeback saves what you type and brings it back. Private, no passwords.

(126 characters. The store limit is 132.)

## Full description

Lost a long comment, a post, or an email to a crash, a closed tab, a session timeout, or a submit that didn't go through? Typeback saves what you type and brings it back.

Typeback is a private form-recovery extension. It keeps text you type into text fields, text areas, and rich editors (mail compose, comment boxes, docs-style editors) on your own computer. Come back to an empty field and a small Restore typed text chip offers the draft. You can also right-click and choose Restore typed text…, or press the shortcut.

What you can do:

- Restore the latest text or an earlier version of the same field.
- Search drafts for this page or for every page, then copy, pin, delete, or restore into the field you're focused on.
- Leave banking and payment sites off. Add any other site to the blocklist.
- Pause saving with one switch.
- Encrypt drafts on disk with a passphrase (AES-GCM). The passphrase is never stored.
- Choose how long unpinned drafts are kept (7 days by default).
- Export or import a JSON backup. The passphrase is not in the file.

Typeback does not save passwords, card numbers, or one-time codes. It does not upload what you type. There is no account.

## Category

Productivity

## Single-purpose statement

Typeback’s single purpose is to recover text the user typed into web forms after a crash, a closed tab, a session timeout, or a failed submit.

## Icons and images

- Icons: `public/icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`
- Screenshots (1280×800): `docs/screenshot-restore.png`, `docs/screenshot-popup.png`, `docs/screenshot-options.png`
- Promo tile (440×280): `docs/promo-440x280.png`

## Permission justifications

Paste these into the permission justification fields.

**storage** — Saves form drafts, version history, settings, and the optional encryption header in chrome.storage.local on the device. The passphrase is held only in chrome.storage.session (memory) so new drafts can be encrypted until the browser quits. Nothing is synced by the extension itself.

**contextMenus** — Adds one item, “Restore typed text…”, to the right-click menu of editable fields so the user can open drafts for that field.

**alarms** — Wakes the extension about once an hour to delete unpinned drafts older than the retention period the user chose.

**Content scripts (`http://*/*` and `https://*/*`, all frames)** — The extension must run on pages the user visits so it can read text they type into forms and write a chosen draft back. Matches are limited to http and https. The script does not fetch remote resources. Host permissions are not requested separately; the content script match is the access.

**Commands (restore-typed-text)** — Suggested shortcut Ctrl+Shift+Y / Command+Shift+Y opens the restore list for the focused field. No extra permission.

## Data-use disclosure

Answer the Chrome Web Store privacy form from this section. The extension does not transmit user data to the developer or to any other server.

**Does the item collect or use user data?**

For remote collection: **No.** Typeback does not transmit form text, URLs, or settings off the device. There is no account and no analytics.

For local use, which the form sometimes asks about separately: **Yes, only on the device, to provide the feature.** Typed form text, a normalized page URL, and a field label are stored in Chrome’s local extension storage so the user can restore them. That data is not sold, not used for advertising, not used to determine creditworthiness, and not transferred to third parties.

**Data type checklist (if the form requires disclosing data handled locally)**

| Data type | Collected remotely? | Handled locally? | Notes |
| --- | --- | --- | --- |
| Personally identifiable information | No | Maybe, only if the user types it into an ordinary text field | Not requested. Payment, password, and OTP fields are excluded. |
| Authentication information | No | No | Passwords and one-time codes are excluded. The encryption passphrase is never written to disk and never transmitted. |
| Financial and payment information | No | No | `autocomplete=cc-*` and card-number-like fields are excluded. Banking domains are blocklisted by default. |
| Health information | No | No | Not requested. |
| Personal communications | No | Maybe, only as text the user typed into a web form | Stored locally so it can be restored. Not transmitted. |
| Location | No | No | |
| Web history | No | Page URL only, locally | Stored so a draft can be matched to the page. The `tabs` permission is not used. |
| User activity | No | Form text the user types | The single purpose of the extension. Not transmitted. |

**Certifications**

- I do not sell user data to third parties.
- I do not use or transfer user data for purposes unrelated to the item’s single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending.
- I do not use or transfer user data for personalized or retargeted advertising.
- I do not transfer user data to third parties except as disclosed. There is no transfer.

**Privacy policy**

Use [PRIVACY.md](PRIVACY.md) in the public repository as the privacy policy URL.

**Remote code**

No. The package is a self-contained Manifest V3 extension. It does not load scripts, CSS, or data from the network.
