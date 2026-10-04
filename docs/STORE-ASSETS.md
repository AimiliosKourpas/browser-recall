# Chrome Web Store assets: what to produce for today's submission

No artwork or screenshots are committed. The repository has no approved logo; the owner supplies the icon files. Capture screenshots from the real extension after the manual QA in `docs/RELEASE-CHECKLIST.md`.

## 1. Extension icons (REQUIRED, blocks the upload)
Put square, transparent-background PNGs in the repository and rebuild; WXT adds the manifest `icons` automatically (verified):

| File | Size | Used for |
|---|---|---|
| `public/icons/16.png` | 16×16 | favicon/menu (required) |
| `public/icons/32.png` | 32×32 | Windows toolbar scaling (recommended) |
| `public/icons/48.png` | 48×48 | extensions management page (required) |
| `public/icons/128.png` | 128×128 | store listing and install dialog (required; artwork ~96×96 centred with 16 px padding) |

The toolbar uses the same icons (no separate `action.default_icon` is needed). After adding them run `npm run build && npm run release:check` (fails while any required icon is missing or has wrong dimensions), then `npm run zip`.

## 2. Screenshots (REQUIRED: at least 1, up to 5)
1280×800 (preferred) or 640×400, PNG or JPEG, full-bleed, no rounded corners/margins. Use a clean profile with ordinary, non-sensitive pages; close personal tabs; show no private URLs.

Recommended order and captions:
1. **Search overlay over a page**, a query typed, results with highlights. Caption: "Find any page you've seen before, from a keyboard shortcut."
2. **Results with Saved/Snippet badges and filter chips** (`is:saved`, "7 days"). Caption: "Search history, pages you remembered and saved quotes together."
3. **Right-click menu** on a page showing "Remember this page" / "Save selection to memory". Caption: "Remember a page or a quote in one click."
4. **Deep Search section of Settings** (off state, permission explanation, excluded sites). Caption: "Deep Search is optional: search what pages say, only if you turn it on."
5. **Settings → What is stored + delete controls**. Caption: "See and control everything that is stored. Local only."

## 3. Promo images
- **Small promo tile 440×280**: REQUIRED by the dashboard for listings (the store asks for it in the Store listing tab); use the logo on a plain background.
- Marquee 1400×560: optional (only used for featuring).
- Demo video (YouTube link): optional; if made, silent screen capture of the flow above, under 60 s.

## 4. Text fields
See `docs/STORE-LISTING.md` (name, summary, description, single purpose, justifications, disclosures, reviewer instructions). Category suggestion: Productivity. Language: English.

## 5. Other dashboard items the owner must supply
Publisher/trader status, contact email (also in the policy), privacy policy URL, optional website/support URL (the GitHub repository works), visibility (recommend **Unlisted** for the first submission).
