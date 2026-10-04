# Browser Recall privacy policy

**Publisher:** Aimilianos Kourpas-Danas  
**Contact:** emil.pedos@gmail.com  
**Effective date:** 4 October 2026  
**This policy is published at:** [PUBLIC POLICY URL]

Browser Recall is a local-first Chrome extension that makes your own browsing searchable.

## The short version
- Everything Browser Recall stores stays on your device, in your browser profile.
- There is no account, no server operated by us, no analytics, no telemetry, no advertising and no remote AI. Browser Recall's own code makes no network requests, and its extension pages cannot (enforced by the extension's Content Security Policy and checked by automated tests).
- We do not receive, sell, share or transfer your data. We cannot see it.
- Deep Search (reading page text) is optional, off by default, and needs a separate permission that you grant.

## What is stored on your device
| Data | When | Where |
|---|---|---|
| Page titles, web addresses, visit times and visit counts from your Chrome history | After you allow history access on the welcome page | Local index (SQLite in the extension's private browser storage) |
| The readable text of pages you open (up to 50 KB per page), headings and description | Only if you turn on Deep Search and grant website access | Same local index |
| Pages and quotes you choose to remember ("Remember this page", "Save selection to memory") | When you use them | Same local index; never expire automatically |
| Settings and progress state (consent version, import checkpoint, retention, storage limit, excluded sites, pause) | Always | The extension's local storage |

Not stored: passwords, form contents, cookies, payment details, images, or anything from private (incognito) windows. Deep Search skips pages with password or payment-card fields, local and intranet addresses and non-HTML files, and sites you exclude.

## Permissions
See `docs/PERMISSIONS.md` (the same list is shown in the Chrome Web Store listing). Website access for Deep Search is an optional permission, requested only when you press the Deep Search button; you can remove it at any time in `chrome://extensions`.

## Your controls
In Settings you can: pause indexing, turn Deep Search on or off, exclude sites, set retention (3, 6, 12, 24 months or until deleted) and a storage limit, choose whether deleting history in Chrome also deletes the local copy, view what is stored per site and per page, delete one page, one site, a date range, all history/Deep Search data, or everything, and export or import your remembered items or everything as a local file. Removing the extension deletes its local data.

## Security notes
Browser Recall does not encrypt its local index. Anyone who can use your computer account or your browser profile can read it; use your operating system's disk and account protection. Exports are plain JSON files stored wherever you save them.

## Limited Use
The use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements: data is used only to provide the user-facing search feature, is not transferred except as necessary for that, is not used for advertising, and is not read by humans.

## Changes and contact
If a change affects what data is read or stored, the in-product consent version is raised and you are asked again before anything new is read. Questions or requests: emil.pedos@gmail.com.
