# Chrome Web Store listing: proposed copy (Browser Recall 0.1.0)

Everything below describes the implemented behaviour only. Strings in `public/_locales/en/messages.json` (`extName`, `extDescription`) are what the store reads as name and summary; keep them identical to this file.

## Name
Browser Recall

## Summary (manifest `description`, 73 characters)
Find any page you've seen before. Private and local, no account.

## Single purpose
Browser Recall lets you search your own browsing history, and the pages and text you choose to remember, from a keyboard-first search box. Everything is indexed and stored locally on your device.

## Detailed description
Browser Recall helps you find a page you have seen before when you only remember part of it.

Press the shortcut (Ctrl+Shift+Y, or ⌘+Shift+Y on Mac; you can change it in Chrome) or click the toolbar icon to open a search box over the page you are on. Type a few words and get results from your Chrome history, from pages you chose to remember, and from saved quotes. Search ignores accents and capitalisation (Greek and Latin text), tolerates small typos, and understands simple filters such as site names and dates.

What you can do
• Search your history by title and address, with the matches highlighted.
• Right-click a page and choose "Remember this page" to keep it, with its text, searchable permanently.
• Select text, right-click and choose "Save selection to memory" to keep a quote; opening it later jumps to the passage when Chrome supports it.
• Optional Deep Search: also index the text of pages you open, so you can find a page by what it says. It is off by default and needs a permission you grant separately.
• See and control what is stored: per-site list, what is stored for any page, delete a page, a site, a date range or everything, pause indexing, choose retention (3, 6, 12, 24 months or until deleted) and a storage limit, export and import your remembered items.

Private by design
• Everything stays on your device, in your browser profile. No account, no server, no analytics, no remote AI. The extension's own code makes no network requests, and its pages are locked by a Content Security Policy that blocks them.
• History is read only after you press "Allow" on the welcome page.
• Deep Search skips private windows, pages with password or payment-card fields, local and intranet addresses and sites you exclude.
• Browser Recall does not encrypt its local index: anyone who can use your computer account or browser profile can read it.
• Open source (MIT).

Good to know
• Deep Search cannot index pages that never finish loading, infinite feeds or text that appears later; PDFs and video are not indexed.
• Deleting history in Chrome also deletes Browser Recall's copy (you can turn this off). Chrome's own automatic expiry of old history does not delete your copy. Pages you remembered are always kept.
• Removing the extension removes its data; export first if you want to keep it.

## Permission justifications (dashboard "Privacy practices" tab)
- **history**: Read the titles, addresses and visit times of pages in Chrome history to build the local search index (once, after the user allows it, then kept current), and to learn when the user deletes history so the matching local copy can be deleted. History data never leaves the device.
- **storage**: Store small local settings and progress state: consent version, import checkpoint, retention, storage limit, pause, excluded sites.
- **unlimitedStorage**: The local search index can exceed Chrome's default extension quota; a user-set storage limit (default 1 GB) bounds it.
- **contextMenus**: The two right-click entries "Remember this page" and "Save selection to memory".
- **activeTab**: When the user presses the search shortcut or toolbar button, or uses a right-click entry, read or show the search overlay in that one tab. No standing access to any website.
- **scripting**: Inject the bundled search overlay into the active tab, and inject the bundled page-text reader into the tab the user chose to remember (or, if the user turned on Deep Search, into pages they open). Only code packaged in the extension is injected; no remote code is loaded.
- **offscreen**: Host the local search engine (WebAssembly SQLite) in a hidden extension page; the service worker cannot run it directly.
- **alarms**: Schedule the daily local cleanup (retention and storage limit), the daily history reconcile, resuming an interrupted import, and a one-time re-read of a just-visited page's title. No network involved.
- **Optional host permissions `https://*/*`, `http://*/*` (Deep Search)**: Requested only when the user presses "Turn on Deep Search" in Settings, with Chrome's own prompt. Needed to read the text of pages the user opens so they can be found by content. The user can decline, or remove it at any time in chrome://extensions; History search and remembered items keep working either way. Without it Deep Search does nothing.
- **Web-accessible resource `search.html`** (http/https pages, dynamic URL): lets the search overlay display the extension's search page in a frame on the current page.

## Remote code
No. All JavaScript and WebAssembly are packaged in the extension; there is no remote code, no `eval`, no externally hosted script; the extension pages' CSP is `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; …`.

## Data-use disclosure (Privacy practices tab)
Data types the extension handles (all processed and stored locally only, never transmitted):
- **Web history**: YES. Page titles, addresses, visit times and counts from Chrome history.
- **Website content**: YES, only if the user turns on Deep Search or uses "Remember". Text of pages, up to 50 KB per page.
- Personally identifiable information, health, financial/payment, authentication, personal communications, location, user activity (clicks, keystrokes, mouse, scroll): NO. (Password and payment-card pages are skipped by Deep Search; keystrokes typed into the search box are not stored.)
Certifications (all true): data is not sold or transferred to third parties outside the approved use cases; not used or transferred for purposes unrelated to the extension's single purpose; not used for creditworthiness or lending. Limited Use statement: see `docs/PRIVACY-POLICY.md`.
Note for the owner: Google's form asks about data "collected"; answer it as above (the data is handled by the extension although it never leaves the device) and rely on the policy to explain "local only".

## Privacy policy URL
Public URL of `docs/PRIVACY-POLICY.md` once the placeholders are filled (see `docs/RELEASE-CHECKLIST.md`).

## Reviewer instructions (test instructions field)
1. Install the extension. A welcome page opens. Click "Allow and import history". Nothing is read before that. The import finishes in seconds on a small profile.
2. Browse to any two or three sites, then press Ctrl+Shift+Y (⌘+Shift+Y on Mac) or click the toolbar icon. A search box opens over the page; type part of a page title and press Enter to open a result. Esc closes it. (On chrome:// pages the same search opens in a small window.)
3. Remember: right-click a page → "Remember this page"; search for a word from its text; the result shows a "Saved" badge. Select text → right-click → "Save selection to memory" to keep a quote.
4. Settings: click "Deep Search settings" in the footer of the search box. Explore pause, retention, the "What is stored" list and the delete buttons.
5. Deep Search (optional permission): in Settings press "Turn on Deep Search". Chrome shows the permission prompt for all sites; Allow. Open any article, wait a few seconds, then search for a phrase from the middle of the article that is not in its title: it is found and labelled. If you deny the prompt, everything else keeps working. You can remove the access in chrome://extensions → Details → Site access; Deep Search then shows as paused.
6. Network: open the service worker's DevTools (chrome://extensions → "service worker") and any extension page's DevTools → Network: no requests are made by the extension.
