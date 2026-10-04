# Permissions: what Browser Recall asks for and why

This table is checked against `src/manifest.ts` by `tests/policy.test.ts`: the permissions listed here must equal the manifest exactly.

## Required permissions
| Permission | Why |
|---|---|
| `history` | Read your Chrome history (titles, addresses, visit times) once and keep it up to date, and learn when you delete history so the local copy can be deleted too. Chrome's install prompt words this as being able to "read and change your browsing history"; Browser Recall only deletes its own copy. |
| `storage` | Small settings and progress state (consent version, import checkpoint, preferences). |
| `unlimitedStorage` | The local search index (SQLite in the browser's private file system) can exceed Chrome's default extension quota. A user-set storage limit (default 1 GB) bounds it. |
| `contextMenus` | The right-click entries "Remember this page" and "Save selection to memory". |
| `activeTab` | Lets the search overlay and "Remember this page" read the one tab you just acted on (shortcut, toolbar click or menu click). No standing access to websites. |
| `scripting` | Injects the search overlay and the page-text reader into that tab (or, with Deep Search on, into pages you open). Only bundled extension code is injected; no remote code. |
| `offscreen` | Hosts the local search engine (WebAssembly SQLite) in a hidden extension page. |
| `alarms` | Daily local cleanup (retention, storage limit) and history reconcile; resuming an interrupted import. |

## Optional host permissions (never required, requested only when you turn on Deep Search)
| Pattern | Why |
|---|---|
| `https://*/*` | Deep Search reads the text of pages you open so they become searchable. Requested from the Deep Search button on the settings page with Chrome's own prompt. Declining or removing it leaves history search and remembered items working. |
| `http://*/*` | Same, for http pages. |

## Web-accessible resources
`search.html` only, for http(s) pages, with a dynamic URL: lets the search overlay show the search page inside the page you are on. It exposes no data.

## Not requested
`tabs`, `webNavigation`, `bookmarks`, `cookies`, `webRequest`, `downloads`, `management`, `identity`, `nativeMessaging`, `proxy`, `debugger`, favicons. No content scripts are declared; there is no required host access; there is no `externally_connectable`.

## Content Security Policy
`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; img-src 'self' data:; style-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'` for all extension pages: no extension page can make a network request or load remote code.
