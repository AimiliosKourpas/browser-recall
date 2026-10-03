# Browser Recall --- Master Product & Engineering Blueprint

Combined source document for the `browser-recall` project.

This file contains the complete pre-build research, product
specification, architecture, and implementation plan prepared on
2026-10-03.

**Project principle:** Find anything you've seen before --- locally,
privately, with no account, no backend, and no paid AI API dependency.

------------------------------------------------------------------------

# PRODUCT_RESEARCH.md

Working concept: "Find anything you've seen before." A privacy-first
Chrome extension that turns browsing history into searchable personal
memory. Research date: 2026-10-03 · Status: pre-build investigation, no
code written, no project initialised. Companion documents:
PRODUCT_SPEC.md (what V1 is), ARCHITECTURE.md (how it is built),
IMPLEMENTATION_PLAN.md (milestones).

How to read this document Evidence is tagged so you can see how much
weight each claim carries.

Tag Meaning \[V\] Verified against first-party documentation I read
during this research (Chrome for Developers, Chrome Help, store
listings). Source number in brackets, e.g. \[S1\]. \[T\] Third-party or
vendor-authored source (trackers, blogs, competitor marketing).
Directionally useful, may be stale or biased. \[I\] My inference or
estimate. Not verified. Each one that matters has a validation step in
IMPLEMENTATION_PLAN.md (milestone M0). User counts for competitors come
mostly from the tracker site extscope.org, with snapshots dated roughly
May to July 2026. Treat them as orders of magnitude, not facts.

1.  Executive summary The idea is real but not new, and it is already
    built many times. I found at least a dozen live Chrome extensions
    doing "full-text search of what you browsed, locally". Almost all
    have fewer than 300 users. The category is easy to enter and hard to
    win. Google is the most important competitor. Chrome ships "History
    search, powered by AI". It stores page content locally but, per
    Google's own help and press coverage, sends queries and matched page
    content to Google for processing \[S19\]\[S21\]. As of the sources I
    could find (May to June 2026) it was limited to the US, English, and
    unmanaged profiles, and Gemini in Chrome had not reached the EU
    \[S22\]\[S39\]. That gap is your opening, and it may close. Chrome's
    built-in history is weak in three specific ways that a third party
    can fix: it only matches titles and URLs, it keeps about 90 days
    locally \[S38\], and it cannot combine domain and date filters well.
    A permission trade-off sits at the centre of the product. Searching
    page content requires reading pages. Doing that automatically needs
    broad host access, which shows the scariest install warning and
    triggers slower Chrome Web Store review \[S15\]. Doing it only on
    user action (activeTab) is safe but is not "no manual action". The
    design resolves this with opt-in Deep Search using optional host
    permissions (see ARCHITECTURE.md §2). Everything you asked for is
    technically feasible in Manifest V3, including a zero-server design.
    The hard parts are background indexing reliability, storage scale,
    and the permission story, not any missing API. Recommended search
    stack for V1: lexical, not semantic. SQLite FTS5 (BM25) running in
    WASM inside an offscreen document, with prefix matching, trigram
    matching on titles and URLs, and good ranking. Semantic search is
    feasible as an opt-in V2 but costs 30 to 120 MB of model weights and
    sustained CPU, and is not needed to be useful. The Chrome Web Store
    requires an in-product disclosure and consent step, a privacy
    policy, a Limited Use statement, and accurate dashboard disclosures,
    even for local-only data \[S12\]\[S14\]. All are cheap to do and
    fatal to skip. Zero recurring cost is achievable. Chrome Web Store
    has a one-time developer registration fee \[S18\]; hosting for the
    privacy policy and docs can be GitHub Pages; CI can run on GitHub
    Actions free tier. Verify the fee amount at registration. Verdict:
    conditional go, as a small, time-boxed, validation-first project.
    Not a heavy investment. See §8 for the stage gates and kill
    criteria.
2.  Competitor analysis 2.1 Landscape at a glance Product Indexes
    content? Auto or manual Search type Where data lives Price Scale
    signal Chrome "History search, powered by AI" (Google) Yes (page
    text) Auto after opt-in Natural language, AI Stored locally,
    encrypted; queries and matched content go to Google \[S19\]\[S21\]
    Free Built in. US/English historically \[S19\]\[S22\] Gemini in
    Chrome: find a page you visited Via synced history Auto Natural
    language Google account and synced history \[S20\] Free EU/UK not
    yet as of May to Jun 2026 \[T\]\[S39\] History Trends Unlimited No
    (titles, URLs) Auto Keyword Local DB Free \~60K users, 4.5★, \~470
    reviews \[T\]\[S25\] Memory (getmemory.net) Yes Auto Full-text; AI
    via your own key (Pro) Local IndexedDB Free core; Pro \$4.99/mo or
    \$39/yr; Lifetime \$79.99 \[S23\] Unknown Memex (WorldBrain) Yes,
    for saved/annotated pages Mostly manual Full-text Local-first,
    optional paid sync Free core + paid \~10K Chrome users (claim by a
    competitor) \[T\]\[S28\] Search Bookmarks, History and Tabs No
    (titles, URLs) n/a Fuzzy and exact Local, no network Free \~3K
    users, 4.9★, 32 reviews \[T\]\[S29\] TraceMind Yes Auto Semantic +
    full-text, in-browser model Local IndexedDB, screenshots Free + paid
    tier \~95 users \[T\]\[S26\] HistorySearch Yes (Readability) Auto
    Full-text, date/domain filters Local, no network permission Free
    \~10 users \[T\]\[S27\] MemoryVault Yes Auto Keyword free; hosted-AI
    semantic in Pro OPFS local; snippets sent to its gateway in Pro Pro
    \$1.99/mo \~3 users \[S24\] Histiq Yes (+PDF) Auto Semantic (MiniLM
    via transformers.js) Local 14-day trial, then paid Founder says
    still hunting first users \[T\]\[S30\] Full Text Tabs Forever Yes
    Auto Full-text Local Unknown \~284 users, 4.3★ \[T\]\[S31\] Findex
    Yes Auto Full-text Local Unknown \~32 users, 2.7★ \[T\]\[S31\]
    StashPad Yes Auto Semantic, plain English Local-first Free Unknown;
    the source I used is vendor-authored \[T\]\[S22\] Legacy: Falcon,
    Deeper History, All Seeing Eye, Chick, Retrospective History Yes
    Auto Full-text Local Free Old; several unmaintained \[T\] 2.2 The
    ones that matter, in detail Chrome's built-in "History search,
    powered by AI" What it does: natural-language search over history
    from the History page, the side panel, or @history in the address
    bar. \[S19\] How search works: when you turn it on, Chrome stores
    page contents locally in addition to title and URL. Only pages
    visited after enabling are searchable. \[S19\] Indexing: automatic,
    opt-in. No manual saving. Privacy model: local storage plus cloud
    processing. Press coverage of Google's disclosure says search terms,
    page content of the best matches, and model output are sent to
    Google \[T\]\[S21\]. Google's own help page is more guarded about
    this; read it directly before quoting it in marketing. Availability:
    US, English Chrome, personal (unmanaged) profile, as of the sources
    I found \[T\]\[S22\]. Gemini in Chrome had not launched in the EU,
    UK, or Switzerland as of May 2026 \[T\]\[S39\]. I could not verify
    the situation as of October 2026. Price: free. What you could do
    differently: work in every country and language, work on managed
    profiles where allowed, and make a verifiable "nothing leaves your
    device" promise. Risk: Google can expand availability at any time,
    and that removes much of the reason to install anything for most
    users. History Trends Unlimited (the only clear scale signal) What
    it does: copies Chrome history into a local database to beat the
    roughly three-month cap, with charts and keyword search. \[S25\]
    Search: keyword on titles and URLs, not page content. \[T\]\[S22\]
    Indexing: automatic, periodic sync. Privacy: local only, never sent
    over the network. Notably, clearing Chrome history does not clear
    its copy, and uninstalling deletes it. \[S25\] Signals: \~60K users,
    4.5★, \~470 reviews. A reviewer complained that backups download
    automatically by default. \[T\] Lesson: the "history that does not
    expire" need is validated at scale. The "search page content" need
    is not validated at scale by anyone. Memory (getmemory.net) What it
    does: auto-indexes pages as you browse, Ctrl+Shift+M to search,
    exclude lists, dashboard. Pro adds AI search with your own API key,
    YouTube transcripts, PDF search, encrypted sync. \[S23\] Pricing:
    Free; Pro \$4.99/mo or \$39/yr; Lifetime \$79.99. \[S23\] Why it
    matters: this is the closest product to your concept and it already
    has a freemium model. User count is not public in what I could
    retrieve. What you could do differently: make the free tier better
    rather than gating, be verifiably offline, open-source it. Memex
    (WorldBrain) What it does: research tool: full-text search over
    pages you bookmark or annotate, highlights, collections, optional
    sync, AI features. \[T\]\[S28\] Reviews: mixed. Firefox reviewers
    cite bugs, a free-tier limit that needs an account and paid
    membership, and a dispute over whether it is truly open source.
    \[T\]\[S28\] Lesson: the heavier "second brain" direction attracts a
    smaller, pickier audience and a lot of maintenance. Your brief
    correctly avoids that. Search Bookmarks, History and Tabs What it
    does: fuzzy and exact search over bookmarks, history, open tabs,
    with tagging. Titles and URLs only. No data collected, no network
    requests. \[S29\] Signals: \~3K users, 4.9★. This shows a fast,
    polished, no-network launcher can earn love, but a launcher without
    content search stays small. \[T\] The near-clones: HistorySearch,
    TraceMind, MemoryVault, Histiq, Full Text Tabs Forever, Findex
    HistorySearch is almost exactly your concept: Readability
    extraction, side panel, date and domain filters, a keyboard
    shortcut, and a "doesn't even request network permissions" claim. It
    has about 10 users. \[T\]\[S27\] TraceMind adds an in-browser
    semantic model and screenshots. About 95 users. \[T\]\[S26\]
    MemoryVault free tier is hash-based keyword search; its Pro tier
    sends query snippets to a hosted gateway. About 3 users. It does
    show a good trust pattern: sensitive domains (banking, email) are
    skipped by default, incognito is ignored, per-domain pause and
    delete. \[S24\] Histiq's founder publicly says installs are low and
    he is looking for first users. \[T\]\[S30\] 2.3 What the market
    tells you Building it is not the hard part. Being found and being
    kept is. More than ten functional products, most with tens of users,
    means distribution and habit are the bottleneck. Only boring,
    single-job tools show real scale. History Trends Unlimited (60K) and
    the fuzzy launcher (3K, 4.9★) do one thing well. "Local semantic
    search" is already a checkbox. At least four products ship it. It is
    not a differentiator on its own. "Zero network" is already being
    used as a trust claim (HistorySearch). It is necessary, not
    sufficient. Pricing exists but proof of willingness to pay is thin.
    Paid tiers range from \$1.99/mo to \$79.99 lifetime. I could not
    find evidence of how many pay. The strongest unmet need is
    retroactive and cross-language usefulness. Competitors that only
    index forward have a cold start. Chrome's own AI feature is
    English-first. 2.4 Is this already solved extremely well? No, but it
    is solved well enough, many times over, for the people who go
    looking. No product is simultaneously widely adopted, excellent, and
    trusted. But the core feature (type a remembered word, find the page
    you read) is commodity. If your plan depends on the core feature
    alone, expect to be one more entry in a long list.

2.5 Differentiation hypotheses (ranked, each with a way to test it) \#
Hypothesis Why it might work Honest weakness How to test H1 Verifiably
private: no network permission, open source, reproducible build, a "what
is stored" screen, deletion that really deletes Browsing history is the
most sensitive data people have; Google's own feature uploads content
for processing \[S21\] HistorySearch already claims it; trust does not
drive discovery Beta: ask testers why they installed and what nearly
stopped them H2 Works immediately by importing existing history on first
run, then deepens over time Removes the cold-start "I searched and
nothing was there" failure Chrome local history is only \~90 days
\[S38\] so day-one content is limited Measure first-session "found
something useful" rate H3 Better ranking and query handling than
competitors: relative dates ("last week"), site: and before: filters,
typo tolerance, accent-insensitive Greek and other non-English Most
competitors are English-centric; Chrome's AI is English only \[S22\]
Hard to market; users judge by results, not features Build a small
labelled relevance set (see ARCHITECTURE §10) H4 "Remember" with
snippets that reopen highlighted using text-fragment links (#:\~:text=)
Few competitors link a saved quote back to the exact passage; costs
nothing server-side Needs real-world check that fragments survive
redirects Prototype in M5 H5 Keyboard-first Spotlight overlay that is
faster than Chrome's History page Daily-use feel; low friction Overlays
are fragile on odd pages; popup fallback needed Latency budget plus a
15-page-type test matrix Not a differentiator: "AI". Do not lead with
it.

3.  Chrome technical feasibility (Manifest V3) Chrome's docs now
    describe a standardised browser.\* namespace available from Chrome
    148 \[V\]\[S1\]. chrome.\* still works.

3.1 API-by-API verdict Capability What is possible Limits and gotchas
Verdict chrome.history search, getVisits, addUrl, deleteUrl,
deleteRange, deleteAll; events onVisited, onVisitRemoved. Needs the
history permission. \[V\]\[S1\] search() returns one row per URL (last
visit time), with title, URL, visitCount, typedCount. No page content.
maxResults defaults to 100. startTime defaults to the last 24 hours if
omitted, so a full import must pass startTime: 0 and page through time
windows. onVisited fires before the page has loaded. VisitItem.isLocal
distinguishes visits synced from other devices. \[V\]\[S1\] Feasible.
Great for a title-and-URL tier. Cannot provide content. Install warning
for history "Read and change your browsing history on all signed-in
devices." \[V\]\[S10\] Alarming wording. The "change" part exists
because delete APIs share the permission. It cannot be narrowed.
Acceptable but must be explained in onboarding. History retention Chrome
keeps roughly 90 days of local history; older entries are archived or
removed unless synced. \[T\]\[S38\] \[S25 states \~3 months\] The exact
behaviour varies. Back-fill depth is whatever history.search returns.
Plan for \~90-day back-fill, then our own archive. \[I\] verify in M0.
Keyboard commands Declare in manifest; commands.onCommand;
\_execute_action opens the action. \[V\]\[S4\] At most 4 suggested
shortcuts. Must include Ctrl or Alt. Ctrl+Alt not allowed. OS and Chrome
shortcuts win over extensions. If another extension has the same
shortcut, the second is silently unassigned; check commands.getAll() at
install. Users can remap at chrome://extensions/shortcuts. Command
events do not fire for \_execute_action. Feasible. Pick the default
shortcut during M0 and tell users how to change it. Context menus
contextMenus with contexts: \["selection"\]; onClicked gives
info.selectionText. \[V\]\[S8\] Menu items can appear on any page
including chrome://. Reading the selection text needs no host
permission. Running a script on the page needs activeTab.
\[V\]\[S7\]\[S8\] Feasible. Ideal for "Save selection". Selected-text
capture selectionText from the menu (plain text). For surrounding
context and a better text-fragment link, run a script via activeTab.
activeTab is granted by an action click, a context-menu click, a
keyboard command, or an omnibox suggestion, and is revoked when the user
navigates to another origin. Not available on chrome:// pages.
\[V\]\[S7\] Feasible. Good UX fallback on restricted pages: store
selectionText only. activeTab + scripting Temporary host access to the
current tab on a user gesture, no install warning. \[V\]\[S7\]\[S11\]
User-initiated only. Cannot index in the background. Right tool for
Remember and Save snippet. Broad host access for auto-indexing
Declarative content scripts or scripting.executeScript on every page.
`<all_urls>`{=html}, *://*/\* give "extensive access to the user's web
activity" and make review slower \[V\]\[S15\]. Warning is the scary
"Read and change all your data on all websites" \[V\]\[S10\]. Avoid as a
required permission. Optional host permissions Declare
optional_host_permissions; call permissions.request() from a user
gesture; adding optional permissions does not disable the extension on
update. \[V\]\[S9\] Whether Chrome Web Store still routes optional broad
hosts through the in-depth review path is not documented; one developer
write-up suggests runtime requests avoid the banner \[T\]\[S37\]. \[I\]
test with a draft upload in M0. Preferred design for Deep Search.
Service worker Handles events; wakes on history.onVisited, commands,
menus. Terminated after 30 s idle, or when one event takes \>5 min, or a
fetch takes \>30 s. Globals are lost. Cannot use Web Storage or DOM.
Extension API calls and events reset timers. \[V\]\[S2\] Use it as a
stateless router. Never hold the index in it. Offscreen document Hidden
page with DOM, workers, WASM. createDocument needs a reasons list;
reason WORKERS allows spawning workers; only AUDIO_PLAYBACK has a
lifetime limit; only one open at a time; only the runtime extension API
is available inside it. \[V\]\[S3\] Must be recreated if closed.
hasDocument() arrived in Chrome 150+; use runtime.getContexts for older
versions. \[V\]\[S3\] Required if running SQLite WASM or any ML model.
Storage storage.local is 10 MB by default; unlimitedStorage lifts it and
also covers IndexedDB, Cache Storage, and OPFS. \[V\]\[S5\]\[S10\]
unlimitedStorage shows no install warning in the permission list.
Extension storage is not cleared when the user clears browsing data.
\[V\]\[S6\] That surprises users and drives the "mirror deletions" rule
in the spec. navigator.storage.persist() and estimate() are available.
Feasible. Opening previous URLs chrome.tabs.create({url}) (no permission
needed for creating). Text-fragment URLs (#:\~:text=) highlight a
passage in Chrome. Fragments can be lost on redirects. Switching to an
already-open tab needs tab URL access. Feasible. Incognito Extensions
are off in incognito unless the user allows it; history API does not
record incognito. Must never index if allowed. Check tab.incognito.
Rule: never index incognito. PDFs and chrome:// pages No script
injection on restricted pages. PDF viewer needs special handling. Both
are out of scope for V1 Deep Search. Document as known limits. 3.2
Background indexing: realistic? Yes, with care. The reliable pattern in
the wild is: the service worker only routes events; heavy work lives in
an offscreen document that hosts a worker. Multiple production
extensions do SQLite in OPFS this way, and Chrome added the WORKERS
offscreen reason in direct response to developers wanting that
\[T\]\[S33\]. One production extension (Distill) reported sync-handle
errors with the default OPFS VFS and moved to the opfs-sahpool VFS
\[T\]\[S33\]. Treat that as the safe default.

What is not realistic:

Keeping an in-memory index inside the service worker. Relying on timers
inside the service worker (use chrome.alarms; minimum period is 30 s
\[V\]\[S2\]). Indexing pages the user never opened (no fetching pages in
the background; it would require network access and break the privacy
promise). 3.3 Performance implications with large histories All numbers
below are \[I\] estimates to be replaced by measurements in M0 and M2.

Quantity Rough estimate Pages for a heavy user over one year 20K to 60K
Extracted readable text per page 3 to 10 KB typical; cap at \~50 KB Raw
text for 20K pages 60 to 200 MB Search database size \~1.5 to 2× text
(postings plus content) Query latency target p95 ≤ 100 ms at 20K pages
In-memory index (MiniSearch-style) at 20K pages Same order as the text,
i.e. 100+ MB, with multi-second cold load. Does not scale to "years of
memory". Implication: a pure in-memory JS index is fine up to a few
thousand pages and a poor foundation for the stated promise. This drives
the SQLite FTS5 recommendation in §5.

4.  Privacy and Chrome Web Store 4.1 What the store requires (all
    verified against current policy pages) Area Requirement Applies to
    us? Privacy policy Required if the product handles any user data;
    must say how data is collected, used, shared, and with whom; link
    goes in the dashboard. \[V\]\[S12\] Yes, even though data stays
    local. The FAQ is explicit: local-only handling still requires
    disclosure and a policy. \[V\]\[S14\] Prominent disclosure and
    consent Before handling user data, show what is collected and how it
    is used, and get affirmative consent inside the product UI. A store
    description or privacy policy alone does not count.
    \[V\]\[S12\]\[S14\] Yes. Build a first-run consent screen. Limited
    Use Use data only for the single purpose; transfer only when
    necessary or legally required; no humans reading user data except
    narrow exceptions; no personalised ads; no sale to data brokers.
    Collecting web browsing activity is prohibited unless required for a
    user-facing feature that is prominently described in the store
    listing and the UI. A Limited Use affirmation must appear on a site
    belonging to the extension. \[V\]\[S13\] Yes. Our history search is
    the user-facing feature. Put the exact affirmation sentence on the
    privacy page. Dashboard data disclosures The Privacy practices tab
    asks which data types you collect and requires certifications;
    disclosures must match the privacy policy and the real behaviour, or
    the item can be removed and the publisher banned.
    \[V\]\[S16\]\[S14\] Yes. Expect to tick web history and website
    content. \[I\] I did not retrieve the exact checkbox list; read the
    dashboard form in M9. Minimum permission Request the narrowest
    permissions; if more than one permission can do the job, choose the
    one with least data access; do not future-proof. \[V\]\[S12\]\[S14\]
    Yes. Drives activeTab + optional host. Single purpose One narrow,
    easy-to-understand purpose; excess permissions are treated as
    enabling unrelated features. \[V\]\[S12\]\[S17\] Purpose: "search
    your own browsing history and saved pages, locally." Keep bookmarks,
    tab manager, analytics, and AI chat out. No remote code, no
    obfuscation MV3 code must be self-contained. Minification allowed;
    obfuscation not. External resources may be data but must contain no
    logic. \[V\]\[S12\] Bundle everything, including WASM. Do not fetch
    models or rules as executable logic. Handling If you collect user
    data, handle it "securely, including transmitting it via modern
    cryptography." \[V\]\[S12\] We transmit nothing. See
    encryption-at-rest question below. Spam and duplicates No duplicate
    extensions from one developer; no review manipulation; no keyword
    spam (e.g., repeating a keyword more than 5 times) \[V\]\[S12\]
    Write a restrained listing. Listing Description, icon, screenshots
    required; metadata must be accurate; no anonymous testimonials.
    \[V\]\[S12\] Fine. Account 2-Step Verification required; one-time
    registration fee; Greece is a supported country. \[V\]\[S12\]\[S18\]
    Fine. Fee amount: confirm at registration. 4.2 Does history access
    create extra review scrutiny? The history permission itself triggers
    a user warning (§3.1) and the store lists "dangerous permission
    requests", new developers, and new extensions as signals for closer
    review. \[V\]\[S15\] Broad host patterns (`<all_urls>`{=html},
    https://*/*) are called out for longer review, because they "can
    collect a user's browsing history, hijack web search behavior,
    scrape data from banking websites". \[V\]\[S15\] Review "typically
    completes within a few days but can take up to a few weeks"; contact
    support if over three weeks. \[V\]\[S15\] Practical consequence:
    first submission will probably be slower than average. Plan M9 for
    it, and do an early draft upload in M0 to see what the dashboard
    says about host permissions. 4.3 Prohibited or high-risk uses
    relevant to us Using browsing activity for anything but the
    disclosed user-facing feature (ads, profiling, analytics-for-sale).
    Human review of user data without explicit consent for specific
    data. Undisclosed collection, or a policy that disagrees with
    behaviour. Bundling unrelated features (e.g., tab manager + ad
    blocker + history search). Loading remote scripts. 4.4 Minimising
    permissions (the plan) Permission Install-time? Warning Why it is
    needed history Required "Read and change your browsing history on
    all signed-in devices" \[S10\] Import and update the searchable
    history storage, unlimitedStorage Required None listed \[S10\]
    Settings and local database contextMenus Required None listed
    \[S10\] Remember page, save selection activeTab, scripting Required
    None \[S7\]\[S10\] Extract text from the current page on user
    action; inject overlay on shortcut offscreen Required None listed
    \[S10\] Host the search database worker alarms Required None listed
    \[S10\] Periodic reconcile and retention optional_host_permissions
    (http://*/*, https://*/*) Optional, runtime Shown only when user
    turns on Deep Search Read text of pages the user views, for local
    indexing Not requested: tabs, webNavigation, bookmarks, cookies,
    webRequest, any host_permissions, any network permission Not needed;
    each would add warnings or review friction 4.5 Privacy policy
    outline Plain-language summary: all data stays on your device; we
    have no servers, no accounts, no analytics. What the extension reads
    (history entries; text of pages you opt in to; text you save) and
    why. Where it is stored (browser's local extension storage on this
    device), for how long (default retention), how to delete it (all, by
    site, by date range), how to export it. What is not done: no
    transmission, no sharing, no ads, no selling, no human access.
    Sensitive-data handling (default exclusions, incognito ignored,
    pause). Permissions table (as above) with justification. Limited Use
    affirmation (use the store's wording). Children, GDPR/data-subject
    rights (local-only, so exercised through the extension), contact,
    change policy, effective date. Statement on what happens if the
    project changes owner (trust issue common with extensions): "we will
    not transfer user data and will announce any ownership change". Not
    legal advice. Have the final text checked if you can.

4.6 Open questions I could not close At-rest encryption. The Chrome Web
Store FAQ says extensions must transmit user data securely "and stored
at rest using a strong encryption method such as RSA or AES."
\[V\]\[S14\] The policy text itself only mandates "handle securely,
including transmitting via modern cryptography." \[V\]\[S12\] Several
large local-only extensions appear to store plaintext locally \[I\], and
full-text indexing is awkward on encrypted data. Resolve by asking
Chrome Web Store developer support before M9 and by recording the
decision as an ADR. See ARCHITECTURE §8. Optional host permissions and
the in-depth review banner. Test with a draft upload in M0. EU trader
status. If the extension stays free, you can declare yourself a
non-trader; a listing seen in the research shows how that label reads to
EU users \[S24\]. If you later charge, trader details become public.
Decide before M9. Fee amount for registration. \[V\] one-time fee exists
\[S18\]; amount not in the page I read. 5. Search architecture
comparison Full design is in ARCHITECTURE.md. This section is the
evidence behind the choice.

Approach Good at Bad at Fit for zero-server V1 Substring (includes, SQL
LIKE) Trivial; exact fragments of titles and URLs Slow on large text; no
ranking; no typo tolerance; no word boundaries Only as a fallback on
titles and URLs Fuzzy (Fuse.js, Levenshtein) Typos in titles and URLs
Fuse scans the whole collection each query and is "optimized for smaller
collections" \[T\]\[S32\]; poor on long text Use only for short fields
BM25 full-text, in-memory (MiniSearch) Small, fast, prefix + fuzzy +
BM25+, zero dependencies \[T\]\[S32\] Index size is the same order as
the corpus; must be rebuilt or loaded into memory each session;
multi-second cold start at large scale Good prototype; weak at "years of
text" BM25 full-text, on disk (SQLite FTS5 via WASM) Persistent,
incremental, built-in bm25(), snippet(), prefix, phrase, NEAR, trigram
tokenizer, diacritic folding; scales to hundreds of MB Needs WASM +
offscreen worker + OPFS; more moving parts; one connection owner;
stemming only for English Recommended Local semantic (embeddings +
vector scan) Matches meaning; "that article about sleep" without the
word Model weights 22 to 118+ MB; embedding every page takes sustained
CPU; English-only for the small model; quality gain over BM25 for
personal history queries is unproven Opt-in V2, after validation 5.1
Semantic search: what it really costs (all \[T\] or \[I\]) The smallest
common model (all-MiniLM-L6-v2, \~22 MB quantized) is English-only.
Products that use it download it at first run. \[T\]\[S30\]\[S34\] A
multilingual model (multilingual-e5-small) covers \~100 languages, but
the quantized ONNX file is about 118 MB; a vocabulary-pruned
English+French variant exists at \~30 MB, which shows how much size is
just the embedding table. \[T\]\[S35\] Running it inside an MV3
extension is a solved pattern: bundle ONNX runtime WASM locally, set the
WASM path to chrome.runtime.getURL(...), add 'wasm-unsafe-eval' to the
CSP, run it in an offscreen document. \[T\]\[S34\] Delivery conflict:
fetching a model from Hugging Face at first run means a network request
and an extra host permission, which contradicts a "no network" promise.
Bundling it makes the package large. One open-source extension documents
exactly this trade-off. \[T\]\[S34\] Storage: 384-dim vectors are \~1.5
KB each as float32 (or \~0.4 KB as int8). 100K chunks is \~150 MB (or
\~40 MB int8). Brute-force cosine over 100K × 384 is tens of
milliseconds. \[I\] Compute: embedding 100K chunks on single-threaded
WASM would plausibly take hours of CPU. \[I\] That means idle-only,
throttled, battery-aware work, and it is the kind of thing that gets an
extension uninstalled. Verdict: feasible, not needed for V1, and best
treated as a spike after V1 has real users and a labelled relevance set
to prove it helps. 5.2 Chrome's built-in AI is not a shortcut I found no
documented embedding API in the Chrome built-in AI surface, and the
Gemini Nano rollout reached the EU months later than elsewhere according
to one secondary source \[T\]\[S39\]. Do not plan around it.

6.  Risks and unknowns register ID Risk Likelihood Impact Mitigation
    Test R1 Nobody finds or keeps it (commodity category) High High
    Narrow wedge (H1 to H5), open source, community launch, stage gates
    G2 beta metrics R2 Google expands native AI history search to your
    markets Medium High Lean on "verifiably local" and "works in your
    language"; re-check availability quarterly Quarterly check R3
    Optional host permission still triggers slow review Medium Medium
    Early draft upload; fall back to history-only first release M0 R4
    Users refuse to grant broad host access for Deep Search Medium High
    Excellent explanation; history-only tier still useful; measure grant
    rate Beta R5 SQLite WASM + OPFS instability in extensions Medium
    High opfs-sahpool, single owner, recovery path, MiniSearch fallback
    behind the same interface M0 spike, M2 R6 Indexing hurts performance
    or battery Medium High Post-load idle extraction, size caps,
    throttling, budgets in CI M6 R7 Extraction quality on SPAs, infinite
    scroll, paywalled pages High Medium Document limits, per-site
    controls, graceful skip M6 fixtures R8 Sensitive pages leak into the
    index Medium Severe Default exclusions, password-field detection,
    token-URL stripping, incognito never, easy per-site delete M6, M8 R9
    Policy mismatch (disclosure vs behaviour) causes removal or ban Low
    if disciplined Severe One source-of-truth permissions manifest,
    tests, checklists M8, M9 R10 Search quality on vague queries
    disappoints without semantic Medium High Relevance eval set, ranking
    work, semantic spike later M2, beta R11 No telemetry means flying
    blind Certain Medium Opt-in local diagnostics export, surveys,
    GitHub issues, store stats M10 R12 Maintenance burden (Chrome API
    changes, site changes, policy changes) High over time Medium Small
    surface area, tests, no frameworks beyond necessity Ongoing
7.  Product-research conclusions that feed the spec Two layers: a safe,
    low-friction history layer (titles, URLs, dates, no host access) and
    an opt-in Deep Search layer (page text). A third explicit layer,
    Saved (Remember and snippets), uses activeTab, needs no broad
    permission, and is user-curated, so it survives history deletion. No
    semantic search, sync, accounts, AI chat, screenshots, or tab
    management in V1. Privacy is a set of mechanisms (no network,
    mirrored deletion, ledger view, default exclusions), not a slogan.
8.  Final Go / No-Go assessment Recommendation: Conditional GO for a
    small, time-boxed, open-source, validation-first build. No-go for a
    heavy investment before the gates below pass. Strongest reasons to
    build Real, recurring pain with proven demand for part of the
    solution. 60K people installed a keyword-only archive to beat the
    90-day cap. \[T\]\[S25\] Nobody dominates. The field is a long tail
    of tiny products plus Google's regionally-limited feature. The
    privacy position is credible and differentiating against Google
    today (cloud processing of matched content, limited regions).
    \[T\]\[S21\]\[S22\] The economics work. No servers, no API bills,
    one-time store fee, free hosting and CI. Technically feasible and
    well-trodden. Every needed pattern (offscreen + SQLite WASM,
    activeTab, optional hosts, text fragments) has public precedent.
    Good as a showcase project even if installs stay modest. Strongest
    reasons not to build Commodity and crowded. More than ten
    near-identical listings; most have tens of users. \[T\] Google is
    attacking the same job natively and can expand at any time.
    \[S19\]\[S22\] The permission trade-off hurts either way.
    History-only is weak (it is the 3K-user launcher). Content indexing
    needs broad host access and a scarier prompt. Monetisation is
    unproven. Free competitors with 60K users exist; paid ones show
    prices but not volumes. If income matters, probability of meaningful
    revenue is low. Habit risk. People search their history rarely. A
    tool used once a month is easy to uninstall. Privacy-first means
    almost no usage data, so product-market-fit signals are slow and
    soft. Biggest technical risk Reliable, low-overhead background
    content extraction and storage at scale inside MV3, specifically:
    SQLite-WASM/OPFS stability in an offscreen document, extraction
    quality on modern web apps, and keeping CPU, memory, and disk within
    budgets, while holding a permission model that review and users
    accept.

Biggest product risk There is no reason to discover, choose, and keep
this over ten similar tools or Google's own feature. Distribution and
habit, not engineering, decide the outcome.

What must be validated before investing heavily \# Question How Pass bar
(my proposal, tune it) V1 Will the permission design pass review without
a long delay? Draft upload in M0 Dashboard shows no in-depth-review
banner for the optional-host design, or you accept a slower first
release V2 Does the engine meet latency and size at 20K pages? Benchmark
in M0 and M2 p95 query ≤ 100 ms, DB ≤ 2× text, cold open ≤ 300 ms V3
Does BM25 find "vague memory" targets often enough? Labelled relevance
set from your own browsing plus 10 testers ≥ 70% top-5 hit rate on
realistic queries V4 Will people grant optional host access? Beta
onboarding ≥ 40% of testers enable Deep Search after reading the
explanation V5 Does it stick? Beta usage and interviews ≥ 40% of testers
still searching weekly in week 3 V6 Does the wedge resonate? Ask testers
why they chose it over Chrome's own and similar tools A repeatable,
specific answer from at least a third V7 Is Google's feature available
in your target markets now? Check support pages and test with a clean
profile, quarterly Not available in Greece/EU, or still clearly worse on
privacy Stage gates (defined in IMPLEMENTATION_PLAN.md) G0 (after M0, a
few days): engine benchmark, permission draft upload, overlay spike.
Stop or re-scope if the engine or permission design fails. G1 (after M6,
dogfood while M7 and M8 proceed): you use it daily for two weeks and
find things you otherwise would not have. If not, stop. G2 (beta): V4 to
V6 pass bars. If they fail, ship as a small open-source tool and stop
investing. Sources Chrome platform documentation

\[S1\] History API:
https://developer.chrome.com/docs/extensions/reference/api/history
\[S2\] Service worker lifecycle:
https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
\[S3\] Offscreen API:
https://developer.chrome.com/docs/extensions/reference/api/offscreen
\[S4\] Commands API:
https://developer.chrome.com/docs/extensions/reference/api/commands
\[S5\] Storage API:
https://developer.chrome.com/docs/extensions/reference/api/storage
\[S6\] Storage and cookies:
https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
\[S7\] activeTab:
https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
\[S8\] contextMenus:
https://developer.chrome.com/docs/extensions/reference/api/contextMenus
\[S9\] Permissions API:
https://developer.chrome.com/docs/extensions/reference/api/permissions
\[S10\] Permissions list and warnings:
https://developer.chrome.com/docs/extensions/reference/permissions-list
\[S11\] Permission warning guidelines:
https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings
Chrome Web Store policy

\[S12\] Program policies:
https://developer.chrome.com/docs/webstore/program-policies/policies
\[S13\] Limited Use:
https://developer.chrome.com/docs/webstore/program-policies/limited-use
\[S14\] User data FAQ:
https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
\[S15\] Review process:
https://developer.chrome.com/docs/webstore/review-process \[S16\]
Privacy fields:
https://developer.chrome.com/docs/webstore/cws-dashboard-privacy \[S17\]
Single purpose FAQ:
https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq
\[S18\] Register a developer account:
https://developer.chrome.com/docs/webstore/register Competitors and
market

\[S19\] Chrome Help, AI history search:
https://support.google.com/chrome/answer/15305774 \[S20\] Chrome Help,
Gemini in Chrome finding pages:
https://support.google.com/chrome/answer/16716225 \[S21\] Windows Latest
on cloud processing:
https://windowslatest.com/2025/02/25/google-chrome-briefly-tests-ai-powered-history-feature-outside-the-us-on-windows-11
\[S22\] StashPad comparison guide (vendor-authored):
https://stashpad.ai/guides/best-chrome-extensions-search-history.html
\[S23\] Memory: https://www.getmemory.net/ \[S24\] MemoryVault listing:
https://chromewebstore.google.com/detail/memoryvault/cdalmdlclenehejeekenomdkgbjngmha
\[S25\] History Trends Unlimited:
https://extscope.org/extension/pnmchffiealhkdloeffcdnbgdnedheme and
https://chromeboard.com/extension/history-trends-unlimited-pnmchffiealhkdloeffcdnbgdnedheme
\[S26\] TraceMind:
https://extscope.org/extension/oefhbcaojanklcjjobagibnkadpnkkbl \[S27\]
HistorySearch:
https://chromewebstore.google.com/detail/historysearch-%E2%80%94-full-text/mdnjibpblcdcofmodpaajkgpjofhdbfg
and https://www.extscope.org/extension/mdnjibpblcdcofmodpaajkgpjofhdbfg
\[S28\] Memex: https://alternativeto.net/software/memex/about,
https://contextbolt.com/bookmarks/compare/contextbolt-vs-memex/,
https://firefox-stats.com/d/worldbrain/reviews \[S29\] Search Bookmarks,
History and Tabs:
https://extscope.org/extension/cofpegcepiccpobikjoddpmmocficdjj \[S30\]
Histiq: https://www.indiehackers.com/product/histiq \[S31\] Full Text
Tabs Forever:
https://www.extscope.org/extension/gfmbnlbnapjmffgcnbopfgmflmlfghel ·
Findex: https://extscope.org/extension/amdnncecokadhjbeehondniflidkjpnc
\[S38\] Chromium history backend notes (90-day archive threshold):
https://kb.digital-detective.net/display/BF/Google+Chrome+HistoryBackend
\[S39\] Gemini in Chrome availability:
https://pasqualepillitteri.it/en/news/3256/gemini-in-chrome-skills-how-they-work-countries-availability
Search and tooling

\[S32\] MiniSearch design document:
https://github.com/lucaong/minisearch/blob/master/DESIGN_DOCUMENT.md
\[S33\] SQLite via OPFS in extensions:
https://github.com/w3c/webextensions/issues/352 · SQLite forum, moving
to opfs-sahpool: https://sqlite.org/forum/forumpost/9ee7f5340802d600
\[S34\] Transformers.js in a Chrome extension:
https://huggingface.co/blog/transformersjs-chrome-extension · Cortex
(model download vs bundle): https://github.com/skumar54uncc/Cortex
\[S35\] multilingual-e5-small pruned q8 (118.31 MB original):
https://huggingface.co/rolf-mozilla/multilingual-e5-small-enfr-pruned-q8
\[S36\] WXT comparison: https://wxt.dev/guide/resources/compare ·
Playwright and Chrome extensions:
https://playwright.dev/python/docs/chrome-extensions \[S37\]
Host-permission review delay write-up:
https://macarthur.me/posts/chrome-extension-host-permission

------------------------------------------------------------------------

# PRODUCT_SPEC.md

Product: "Find anything you've seen before." (working concept; name to
be chosen, see §11) Spec version: 0.1 (pre-build) · Date: 2026-10-03
Read first: PRODUCT_RESEARCH.md (evidence and verdict). Companions:
ARCHITECTURE.md, IMPLEMENTATION_PLAN.md.

Items marked \[DECIDE\] need a decision from you. Items marked \[TUNE\]
are proposed defaults to be adjusted after measurement.

1.  Product definition One sentence: Press a shortcut, type what you
    remember, and get back the page you saw. Everything stays on your
    device.

Single purpose (also the Chrome Web Store field): Search the user's own
browsing history and explicitly saved pages and snippets, entirely on
the user's device.

Who it is for

People who often think "I saw this somewhere last week" (researchers,
developers, students, shoppers, writers). People who distrust cloud
tools with their browsing history. People outside the US or English-only
markets, where Chrome's own AI history search may not be available.
(Verify; see Research §2.2.) Jobs to be done

"I remember a detail from a page, not its title. Get me back to it." "I
know roughly when and on which site. Narrow it down." "This page
matters. Keep it findable even if I clear my history." "Keep that quote
with where it came from." 2. Principles (privacy as mechanisms, not
slogans) Principle What it means in the product Nothing leaves the
device No servers, accounts, analytics, crash reporters, or network
permission. Enforced by tests (Architecture §8). Ask before reading
pages Reading page text is an explicit opt-in (Deep Search) with a
plain-language explanation before Chrome's permission prompt. User
deletions are honoured If you delete something from Chrome history, it
disappears here too (except pages you explicitly saved). Always visible,
always deletable A "what's stored" view; delete by page, site, date
range, or everything. Safe by default Sensitive sites, intranets, login
pages, and incognito are never indexed. Small surface One purpose. No
unrelated features. 3. Killer feature and why install this over Chrome
History Killer feature: Find it by what you remember about it, in under
a second, from a keyboard shortcut, with nothing leaving your device.

Chrome History page Chrome's AI history search This product Matches page
text No (titles and URLs) Yes, only after you enable it, US/English
historically \[Research §2.2\] Yes, with opt-in Deep Search; works in
any language the pages use Content processed locally n/a Stored locally;
matched content sent to Google for AI answers \[Research §2.2\] Fully
local, no network permission Keeps history beyond \~90 days No No Yes
(your own archive, configurable) Domain + date filters together Limited
Limited Yes (site:, after:, before:, chips) Opens from a shortcut
anywhere No (opens a page) Address bar @history Yes, overlay on the
current page Save important pages and quotes permanently No No Yes
(Remember, snippets with highlight links) Works offline Yes Partly Yes
Honest caveat: the core idea exists in many products. The product wins
on trust, speed, and polish, not on a unique capability. See Research
§2.5 for the five differentiation hypotheses.

4.  V1 scope 4.1 Three layers Layer What it holds Permission needed
    Default History Titles, URLs, visit times and counts from Chrome
    history history only On after consent Deep Search Readable text of
    pages you view Optional host permission, requested at runtime Off
    until you opt in Saved Pages you Remember and snippets you save
    activeTab (user gesture) Always available 4.2 In scope for V1
    Spotlight-style search opened by a keyboard shortcut (and the
    toolbar icon). Search over History, Saved, and (if enabled) Deep
    Search content in one ranked list. Filters: domain (site:), date
    (after:, before:, when:), source (is:saved, is:snippet), plus filter
    chips in the UI. Click or Enter opens the original page. Remember
    the current page (shortcut, right-click menu, toolbar menu). Save
    selected text as a snippet (right-click). Opening a snippet result
    jumps to and highlights the passage when the page still contains it.
    Deep Search (opt-in): automatic local indexing of pages you view,
    with default exclusions and per-site controls. First-run import of
    existing Chrome history (back-fill). Privacy controls: pause,
    exclude site, delete (page, site, date range, all), retention,
    storage cap, export and import of your own data, mirrored deletion.
    "What's stored" ledger view. Onboarding with consent and permission
    explanations. Light and dark mode, keyboard-only operation,
    screen-reader support. English UI with the string catalogue ready
    for Greek (final language list \[DECIDE\]). 4.3 Explicitly out of V1
    (and when to revisit) Not in V1 Why Revisit Semantic or embedding
    search Large models, heavy CPU, unproven gain; lexical search is
    enough to start (Research §5) After beta, with a relevance eval set
    AI chat or "ask your history" Needs models or paid APIs; invites
    privacy concerns V2 at earliest Cloud sync, accounts Breaks the
    privacy promise and zero-cost goal Possibly user-managed file export
    only Screenshots or thumbnails Storage cost, privacy surface, more
    permissions V2 PDF and YouTube transcript indexing Extraction
    complexity, different pipelines V1.1 (PDF), later (video) Tabs and
    bookmarks search Dilutes the single purpose; competitors already do
    it V1.1 only if the purpose statement still holds Tags, collections,
    folders, notes Becomes a second-brain app (Memex territory) Later,
    if requested History analytics and charts Different job; History
    Trends Unlimited owns it Not planned Session or "journey" grouping
    Feature bloat Maybe V2 Omnibox keyword Cheap but adds a surface V1.1
    Firefox and Safari No offscreen documents there (Research §3,
    Architecture §1) Not planned Edge or Brave store releases
    Chromium-compatible, so low cost After V1 stabilises Mobile Chrome
    mobile does not run extensions Not planned Telemetry Contradicts the
    privacy promise Never Ads, affiliate links, paid tier Out of scope
    for V1 \[DECIDE\] later 4.4 Release options \[DECIDE\] R1: History +
    Saved only (no host permission). Fast review, weak differentiation
    (resembles a 3K-user fuzzy launcher). R2: R1 + opt-in Deep Search.
    Recommended as the public V1, because content search is the actual
    value. Path I recommend: build everything, run an unlisted beta of
    R2 first, then go public once the gates in IMPLEMENTATION_PLAN.md
    pass. (Unlisted visibility is a Chrome Web Store option; confirm in
    the dashboard.)
5.  Behaviour in detail 5.1 First run After install, a welcome tab
    opens. Screen 1, what this does: plain-language summary and a
    "nothing leaves your device" statement. Screen 2, consent for
    history (required to use the product): "To make your history
    searchable, this extension reads your Chrome browsing history (page
    titles, addresses, and visit times) and stores a private copy on
    this device. It never sends it anywhere." Button: Allow and import
    history. Secondary: No thanks (extension stays inert). Heads-up
    line: "Chrome's install prompt says the extension can 'change' your
    history. That wording covers delete features; this extension only
    deletes things when you ask it to." Screen 3, Deep Search (optional,
    skippable): "Want to search the text of pages, not just titles? Deep
    Search saves the readable text of pages you view, on this device
    only. Chrome will ask for permission to read websites. You can skip
    this and turn it on later." Plain list: what is saved, what is
    skipped by default (banking, email, login pages, private networks,
    incognito), how to pause and delete. Button: Turn on Deep Search
    (triggers Chrome's permission prompt from the click). Secondary: Not
    now. Screen 4, shortcuts: shows the current shortcut for Search and
    for Remember, and a link to chrome://extensions/shortcuts if a
    conflict left one unassigned (detected via the commands API).
    Back-fill runs in the background with a progress line in the search
    UI. Consent is versioned. If data practices ever change, the user is
    asked again.

5.2 Search Open: keyboard shortcut (proposed default pair, to be checked
for conflicts in M0 \[DECIDE\]): Search and Remember page. The toolbar
icon also opens Search.

Surface: a centred overlay over the current page. On pages where
overlays are impossible (chrome://, the Web Store, new tab page, some
PDFs), the same UI opens in a small popup window.

Layout

Input at top, filter chips under it (Date: Any, Today, Yesterday, 7
days, 30 days, Custom · Source: All, Saved, History, Deep · Domain: type
to pick). Results list (up to 50, "show more" to 200). Footer: index
status ("12,480 pages · Deep Search on · last indexed 2 min ago"), pause
toggle, settings. Result row

Title with matches highlighted. Domain and shortened path. Date:
relative ("3 days ago"), absolute on hover. Badges: Saved, Snippet.
Match line: a snippet of page text with the match highlighted (Deep
tier), or "Title and address match" (History tier). No favicons in V1.
Favicons need an extra permission that warns "Read the icons of the
websites you visit". Use a coloured letter avatar from the domain.
Keyboard

Key Action ↑ ↓ Move selection Enter Open in the current tab Ctrl/⌘ +
Enter Open in a new background tab Shift + Enter Open in a new tab and
focus it Tab Move to the row's action menu Esc Close; return focus to
the page Ctrl/⌘ + K Focus the filter bar Enter during IME composition
must not open a result (needed for Greek, Japanese, Chinese, and other
IME users).

Row actions: Open · Open in new tab · Copy link · Remember · Forget this
page · Exclude this site.

Query language (kept small)

Syntax Meaning word word All words must match; the last word also
matches as a prefix "exact phrase" Phrase match -word Exclude
site:example.com / -site:example.com Domain and subdomains
after:2026-09-01 · before:2026-09-30 · after:7d · after:2w · after:3m
Date range (last-visit time) when:today · yesterday · week · month ·
year Date presets is:saved · is:snippet Source filters Natural-language
dates in free text ("last week") are not parsed in V1, because they
collide with real words in titles. Use chips or when:.

Ranking (details in Architecture §5): text relevance (BM25) with title
and URL boosts, plus recency, visit frequency, and a boost for Saved
items. Fully local, no personalisation outside the device.

Typos and no results: the UI proposes "Did you mean..." using words
already in your index, and offers to widen the date range.

Empty and loading states: first-run "Indexing your history... 40%"; "No
matches. Try fewer words, remove a filter, or turn on Deep Search to
search page text."

5.3 Remember a page Trigger: shortcut, right-click → "Remember this
page", or the toolbar menu. Uses activeTab (granted by the gesture) to
extract the page's readable text and title. Stores a Saved record:
title, URL, saved time, text. It is not removed by mirrored deletion or
retention. Toast: "Remembered. Find it any time with is:saved." On pages
where extraction is impossible (chrome://, PDFs in V1), store title and
URL only and say so in the toast. 5.4 Save a snippet Trigger: select
text → right-click → "Save selection to memory". Stores the exact
selected text, page URL and title, time, and a text-fragment link built
from the selection. Snippet result row shows the quote with the source
underneath. Opening it navigates to URL#:\~:text=... so Chrome
highlights the passage when it still exists; otherwise it just opens the
page. Very long selections are truncated with a visible notice (limit to
be set in M5 \[TUNE\], proposed 5,000 characters). 5.5 Deep Search
(opt-in) What is indexed: title, address, meta description, headings,
main readable text (cap \~50 KB \[TUNE\]), language. Nothing else: no
form fields, cookies, images, or storage.

When: only for pages you actually viewed. A page qualifies after it
finishes loading and the tab has been visible for a few seconds \[TUNE:
5 s\]. Re-index at most once a day per address, and only if the content
changed.

Never indexed (defaults)

Incognito windows (even if the extension is allowed there). Non-web
schemes (chrome://, file://, blob:, data:, view-source:). Private
networks and intranets (localhost, \*.local, 10.x, 172.16--31.x,
192.168.x). Pages containing a password field or payment-card input.
Addresses with token-like query parameters (token, access_token, code,
sig, session, and similar). A bundled starter list of sensitive domain
types (banking and payments, webmail, health portals, password
managers). The list is visible and editable. Pages that give almost no
readable text (fall back to title-only). Controls: pause (1 hour, until
tomorrow, until resumed), exclude this site, forget this page, delete by
site or date, and a per-site list in the ledger.

Known limits (shown in Settings → About indexing): single-page apps that
never navigate, infinite-scroll feeds, pages behind heavy client-side
rendering, and content loaded after the capture moment may be partly or
not indexed. PDFs and videos are not indexed in V1.

5.6 Privacy and data controls Mirrored deletion (default on): when you
delete history in Chrome (a specific page, a time range, or everything),
the matching History and Deep Search data here is deleted too. Saved
items are kept, because you explicitly chose them. This matters because
extension storage is not cleared by Chrome's "clear browsing data".
\[Research §3.1\] Automatic expiry is not a deletion: Chrome's own
\~90-day expiry must not erase your archive. The product tells
user-initiated deletion apart from automatic expiry \[I\]; verification
is part of M0. Retention (default 12 months for History and Deep Search
data \[TUNE\]), options 3, 6, 12, 24 months, or keep until deleted.
Saved items never expire. Storage cap (default 1 GB \[TUNE\]); when
reached, oldest Deep Search text is trimmed first, titles and URLs last.
A usage meter is shown. Ledger view: per-domain table (pages, size, last
indexed) with Exclude, Delete, and a "view what's stored for this page"
preview. Delete: one page · one site · a date range · everything
(type-to-confirm). Export / import: JSON of Saved items and snippets
(and optionally everything). Local files only. Pause indicator: the
toolbar icon shows a paused state. Uninstall: Chrome removes extension
storage on uninstall. Settings say so, and recommend exporting first.
5.7 Settings (proposed) Group Setting Default General Shortcuts (link to
Chrome's page), theme System History History layer on/off On Deep Search
On/off; exclusion list; dwell time Off Data Retention, storage cap,
mirrored deletion 12 months, 1 GB, On Data Delete controls, export,
import n/a Privacy Ledger, pause, incognito note n/a About Version,
permissions explained, policy link, source link, "Copy diagnostics" n/a
"Copy diagnostics" copies counts only (page counts, DB size, version,
last errors with no URLs) to the clipboard for you to paste into a bug
report. Nothing is sent automatically.

5.8 Accessibility and internationalisation WCAG 2.2 AA target: listbox
semantics for results, visible focus, sufficient contrast,
reduced-motion support, screen-reader announcements for result counts
and indexing status. Full keyboard operation, no mouse required.
Right-to-left layout supported structurally (logical CSS properties).
Text search is Unicode-aware and accent-insensitive (Greek tonos, Latin
diacritics). CJK is limited in V1 (no word segmentation); documented. UI
strings in a message catalogue; English at launch, Greek if \[DECIDE\]
yes. 5.9 Failure states (all must be handled and tested) Another
extension owns the shortcut → onboarding and settings show how to
reassign. Overlay impossible on this page → open popup window. Offscreen
document closed or crashed → transparent restart; search shows a short
"starting" state. Database corrupt or too new → read-only recovery
screen with export and reset. Permission revoked by the user → Deep
Search shows "off" with a one-click re-request. Storage full → pause
Deep Search, explain, offer cleanup. Browser restart mid-index → resume
without duplicates. 6. What would make a user uninstall it (and what we
do about it) Trigger Mitigation Scary install prompt Only history at
install; explain it; broad host access only on opt-in Slows browsing or
drains battery Extract after load, only visible pages, size caps,
throttling, performance budgets in CI Indexes private pages Safe
defaults, visible lists, per-site delete, pause Searched and found
nothing (cold start, bad ranking) History import on first run; relevance
eval set; typo suggestions "I cleared history but it's still there"
Mirrored deletion; clear explanation; delete-all Shortcut conflicts or
overlay does not open Detection, popup-window fallback, clear help
Storage grows without limit Retention and cap defaults, usage meter
Wrong results shown to someone else (shared screen) Quick pause; future
"hide previews" option Bugs that break pages Run after load; never
modify page DOM except the isolated overlay; e2e tests on varied pages
Loss of trust after an ownership change or policy change Open source,
no-network guarantee, ownership statement, versioned consent 7. Privacy
concerns users will have, and our answers Concern Answer in the product
"Does my history leave my computer?" No servers, no network permission;
verifiable in the manifest and source "Will it read my banking or
email?" Default exclusions; password and payment fields detected;
incognito never; easy deletion "Can another person using this computer
see it?" Same exposure as Chrome's History page for the same profile;
per-profile storage; note about shared profiles; optional encryption
decision in Architecture §8 "What if I clear my history?" Mirrored
deletion; Saved items stay by design "What does the extension do on
uninstall?" Chrome deletes its storage; export first "Who is behind it
and will it be sold?" Publisher info, open source, ownership-change
statement "Why does it say it can change my history?" Plain explanation
in onboarding "Is the code auditable?" Public repository, reproducible
build instructions, no obfuscation 8. Success measures and budgets
Quality budgets (proposed, \[TUNE\] after M0/M2 measurements)

Search latency p95 ≤ 100 ms at 20K indexed pages, excluding render.
Overlay opens and accepts typing in ≤ 150 ms (warm) on a typical page.
Page-load impact of Deep Search: none measurable; extraction runs after
load and finishes in ≤ 100 ms p95 on typical pages. Offscreen worker
memory ≤ 150 MB at 20K pages. Disk use ≤ 2× extracted text. Beta
outcomes (all collected by survey or user-pasted diagnostics, never
automatically)

Deep Search opt-in rate ≥ 40% of testers. Weekly use in week 3 ≥ 40% of
testers. "Found something I would not have found otherwise" in ≥ 60% of
testers. Relevance: ≥ 70% top-5 hit rate on a labelled query set
(Architecture §10). Review of crash and bug reports: no data-loss bugs
open. 9. Non-functional requirements Chrome (stable) on Windows, macOS,
Linux. ChromeOS best effort. Minimum Chrome version to be set in M0
(documentation shows recent APIs arriving in Chrome 148 and 150, so
avoid depending on them). Manifest V3, TypeScript, no remote code, no
obfuscation. Works offline. Per-profile data, never shared across
profiles. Graceful behaviour with hundreds of thousands of history rows
(paged import). 10. Store listing draft (for M9) Name: see §11. Short
description (≤132 characters): "Find any page you've seen before.
Private and local, no account. Press a shortcut, type what you
remember." (verify length at submission) Single purpose: as in §1.
Category: Productivity.

Permission justifications (dashboard text)

history: reads the user's browsing history to build a local, searchable
copy. storage, unlimitedStorage: stores settings and the local search
database on the device. contextMenus: provides "Remember this page" and
"Save selection to memory". activeTab, scripting: reads the text of the
current page only when the user presses the shortcut, uses the menu, or
opens search; shows the search overlay. offscreen: hosts the local
search database worker (service workers cannot run it). alarms:
schedules local maintenance (retention and reconciling history).
Optional host access: only if the user turns on Deep Search; used to
read the text of pages the user views, for local indexing, with default
exclusions. Remote code: "No, I am not using remote code." Data
disclosures: web history and website content handled locally; no
transfer; Limited Use certified. (Match the privacy policy exactly.)

Listing assets: 5 screenshots (overlay search, filters, Remember and
snippets, privacy ledger, onboarding), a short silent demo clip, a promo
tile. No keyword stuffing. No unattributed testimonials.

11. Open product decisions \[DECIDE\] Name. Avoid collisions: "Memory",
    "Recall", "Vault", "Seen Before" (an existing job-tracker extension
    uses that name), and "Retrospective History" are already taken or
    too close. Brainstorm a short, distinctive name and check trademarks
    and the store. Placeholder only: none verified. Open source and
    license (recommended: public repo under a permissive licence;
    supports the trust story and costs nothing). Monetisation stance:
    free forever, donations, or a later optional paid tier. V1 ships
    free with no ads. If you ever charge, EU trader details become
    public on the listing. Language at launch: English only, or
    English + Greek. Public launch path: unlisted beta first
    (recommended), or straight to public. Default shortcuts (decide
    after conflict checks in M0). At-rest encryption policy (see
    Architecture §8 and the open question in Research §4.6). Retention
    and cap defaults (12 months, 1 GB proposed). Edge and Brave:
    officially unsupported in V1, or smoke-tested.

------------------------------------------------------------------------

# ARCHITECTURE.md

Scope: production architecture for the V1 described in PRODUCT_SPEC.md.
No code yet; this is design. Date: 2026-10-03 · Evidence tags: \[V\]
verified in docs, \[T\] third-party, \[I\] inference to be validated in
M0. Source numbers refer to PRODUCT_RESEARCH.md.

1.  Constraints and headline decisions \# Decision Why Status D1
    Manifest V3, TypeScript, Chrome-only for V1 Offscreen documents
    (needed for WASM workers) exist in Chrome, not in Firefox or Safari
    \[S3\]\[T\]\[S33\] Decided D2 History layer needs only the history
    permission Smallest install-time footprint Decided D3 Deep Search
    uses optional_host_permissions requested at runtime from a user
    gesture Avoids a required broad host permission and its review
    friction \[S15\]\[S9\] Decided; review impact to verify in M0 D4
    Remember / Save snippet use activeTab + scripting Gesture-scoped
    access, no install warning \[S7\] Decided D5 Search engine: SQLite
    FTS5 in WASM, in an offscreen-hosted worker, opfs-sahpool VFS
    Persistent, incremental, BM25, snippets, prefix, trigram; scales
    beyond in-memory JS \[S32\]\[S33\] Gated by M0 benchmark; MiniSearch
    fallback behind the same interface D6 UI surface: iframe overlay
    (extension page inside an in-page host) with popup-window fallback
    Keystrokes in a cross-origin iframe do not bubble to the page, so
    page scripts cannot read the user's query \[I\] Gated by M0 spike D7
    Page text extraction is driven by the service worker with
    scripting.executeScript, not by declarative content scripts
    Exclusions and consent are checked before any code touches a page
    Decided D8 No telemetry, no network use of any kind Product promise
    and store policy alignment Decided D9 Lexical search only in V1;
    semantic is a later, opt-in spike Cost, size, unproven gain
    (Research §5) Decided D10 Framework: WXT (Vite), Preact UI, plain
    CSS Maintained, MV3-first, zip output \[T\]\[S36\] Proposed
2.  System overview ┌─────────────────────────────────────────────┐ │
    Chrome │ │ history DB tabs commands menus alarms │
    └───────┬─────────┬───────┬─────────┬───────────┘ │ events │ │ │
    ┌───────────────────────────────▼─────────▼───────▼─────────▼───────────────┐
    │ SERVICE WORKER (stateless router) │ │ • registers every listener
    at top level │ │ • history.onVisited / onVisitRemoved,
    tabs.onUpdated, commands, menus │ │ • ensures the offscreen engine
    exists │ │ • applies capture policy (consent, exclusions, dwell)
    before extraction │ │ • drives scripting.executeScript (extractor,
    overlay host) │
    └───────┬───────────────────────────────┬────────────────────────────────────┘
    │ runtime messages (validated) │ executeScript │ ▼ │
    ┌─────────────────────────┐ │ │ PAGE (isolated world) │ │ │
    extractor.js (on user │ │ │ gesture or Deep Search)│ │ │ overlay
    host + iframe │ │ └──────────┬──────────────┘ │ │ iframe = extension
    page (search UI)
    ┌───────▼─────────────────────────────────────────────────────────────▼─────┐
    │ OFFSCREEN DOCUMENT (reason: WORKERS) │ │ └─ Dedicated Worker:
    sqlite-wasm + opfs-sahpool ← single owner of the DB │ │ SearchStore:
    schema, migrations, FTS5, ranking, maintenance │
    └────────────────────────────────────────────────────────────────────────────┘

UI pages (extension origin): search.html (overlay + popup window),
onboarding.html, options.html • talk to the engine over a named runtime
Port, never to the page chrome.storage.local: small settings only
(consent version, flags, lists, cursors) 2.1 Responsibilities Component
Owns Must never Service worker Event wiring, routing, policy decisions,
offscreen lifecycle Hold the index or any long-lived state; do network
calls; run long tasks (\>30 s idle limit, 5 min event limit \[S2\])
Offscreen document + worker The database and all search logic Touch tabs
or pages; use any API except runtime \[S3\] Extractor (injected) Reading
the current page's text and metadata Modify the page DOM; make requests;
keep running after returning Overlay host (injected) A closed shadow
root holding one iframe, focus management, Esc handling Render results
itself; receive the query UI pages Rendering and input Parse untrusted
HTML; use innerHTML chrome.storage.local Small settings (\<1 MB) Hold
page data 2.2 Why the engine lives in an offscreen document Service
workers cannot create Workers or use the DOM, and OPFS sync handles need
a dedicated Worker \[T\]\[S33\]. The offscreen WORKERS reason exists for
exactly this \[V\]\[S3\]. Only one offscreen document may exist per
profile \[V\]\[S3\], and opfs-sahpool allows one connection, so the
engine is a single owner reached over messages. AUDIO_PLAYBACK is the
only reason with a lifetime limit; WORKERS documents do not time out
\[V\]\[S3\]. We still close the document after an idle period to save
memory (tuned in M0). 3. Manifest and permissions (design, not code)
Item Value manifest_version 3 minimum_chrome_version Decide in M0 (the
2026 docs mention browser.\* from 148 and offscreen.hasDocument from 150
\[V\]\[S3\]; do not depend on them). runtime.getContexts exists from 116
\[V\]\[S3\]. permissions history, storage, unlimitedStorage,
contextMenus, activeTab, scripting, offscreen, alarms
optional_host_permissions https://*/*, http://*/* (requested only for
Deep Search; file:// is never requested) host_permissions none commands
open-search (suggested shortcut), remember-page (suggested shortcut). At
most 4 suggested are allowed; Ctrl or Alt required; Ctrl+Alt not allowed
\[V\]\[S4\] action No popup. Click opens search.
web_accessible_resources Only search.html and its assets, for the
overlay iframe; evaluate use_dynamic_url to reduce fingerprinting \[I\]
content_security_policy.extension_pages Locked down: scripts from 'self'
plus 'wasm-unsafe-eval' (needed for SQLite WASM), connect-src 'none',
default-src 'none', images from self and data only, no framing, no form
actions. Verify Chrome accepts these extra directives in M1 \[I\] Not
requested tabs, webNavigation, bookmarks, cookies, webRequest, favicon,
downloads, management, any required host permission Expected install
warning: "Read and change your browsing history on all signed-in
devices" \[V\]\[S10\]. Everything else in the required list shows no
warning in the permission list \[S10\]. Deep Search shows Chrome's own
prompt at opt-in time.

Important honesty note on "no network": not having host_permissions does
not prevent an extension from sending requests (cross-origin fetch,
beacons, and image loads can still send data even if the response is
unreadable) \[I\]. Real enforcement is (a) the CSP connect-src 'none'
above, (b) a lint ban on network APIs, (c) an end-to-end test that
records every request made by extension contexts, and (d) open source.
Marketing should say "the extension is built so it cannot send your data
anywhere, and here is how you can check", not merely "no network
permission".

4.  Runtime flows 4.1 Install, consent, back-fill runtime.onInstalled
    opens onboarding.html. Consent screens (Spec §5.1). Nothing is read
    before consent. Consent version is stored. After consent, the
    service worker pages through history: history.search with startTime:
    0 (the default is the last 24 hours \[V\]\[S1\]) in 7-day windows
    and a high maxResults (default is 100 \[V\]\[S1\]), sending batches
    of ≤1,000 rows to the engine. A cursor in storage.local makes it
    resumable. History synced from other devices appears too
    (VisitItem.isLocal is false \[V\]\[S1\]); store as title-only. 4.2
    Live updates history.onVisited fires before the page loads
    \[V\]\[S1\]. It records/updates the page row (title, URL, count,
    time) and nothing more. A daily alarms job plus runtime.onStartup
    reconcile: re-query history since the last reconcile and upsert, so
    missed events do not matter. 4.3 Deep Search capture (opt-in)
    tabs.onUpdated (status complete, or URL change for single-page apps)
    → service worker checks the capture policy (§6): consent, feature
    on, permission present (permissions.contains), not incognito,
    scheme, host not excluded, not paused, not seen recently. If the tab
    is hidden, wait for tabs.onActivated. Require a visible dwell
    (default 5 s, via alarms, which has a 30 s minimum period
    \[V\]\[S2\], so combine a short in-page timer inside the injected
    function with a one-shot alarm fallback) \[I: finalise in M6\].
    Inject the extractor with scripting.executeScript. It returns
    structured text or a "skip" reason. The service worker forwards the
    result to the engine, which stores it and updates FTS in one
    transaction. Concurrency 1, with rate limiting. If the engine is
    busy, results are dropped, not queued unboundedly (the next visit
    will retry). 4.4 Search UI opens a named Port to the engine (via
    runtime.connect, so it does not keep the service worker alive; ports
    to the service worker would \[V\]\[S2\]). If the engine is not
    running, the UI asks the service worker to create the offscreen
    document, then reconnects. Each keystroke sends a query with a
    request id; stale responses are discarded; typing is debounced
    lightly (\~30 ms) because queries are local. Results stream back:
    top rows first, then snippets. 4.5 Remember and Save snippet
    Remember: gesture → activeTab → inject extractor → engine stores
    page with saved_at and full text. Snippet: context menu gives
    selectionText without any host permission \[V\]\[S8\]; with
    activeTab we may also read a little surrounding text to build a
    robust text-fragment. If the page is restricted, store only the
    selected text, URL and title. 4.6 Deletion mirroring
    history.onVisitRemoved provides allHistory or a URL list
    \[V\]\[S1\]. allHistory → delete all non-saved data. URL list →
    delete those URLs' non-saved data. Automatic expiry vs user
    deletion: Chrome expires old entries itself (\~90 days
    \[T\]\[S38\]). It is unverified whether expiry fires onVisitRemoved.
    The archive must survive expiry. Spike in M0: observe events across
    expiry; if indistinguishable, apply the heuristic "ignore removals
    of URLs whose last visit we recorded more than \~80 days ago unless
    allHistory is true", and expose a setting. 4.7 Maintenance Daily
    alarm: retention sweep, storage cap enforcement (trim Deep Search
    text before titles), incremental_vacuum, integrity check on a
    schedule, stats refresh. Settings changes (retention, exclusions)
    trigger immediate sweeps.
5.  Search design 5.1 Data model (conceptual) Table Key columns Notes
    pages id, normalized url (unique), domain, title, first_seen,
    last_visit, visit_count, typed_count, lang, flags (has_history,
    has_content, is_saved), saved_at, content_hash, content_indexed_at
    One row per normalized URL. Tracking parameters and fragments
    stripped (keep canonical if present). contents page_id, body,
    headings, description, bytes Separate so list queries do not load
    text. Optional compression (see §5.5). snippets id, page_id or url,
    text, created_at, fragment User-saved quotes. Never expire.
    recent_visits (optional) page_id, ts (cap \~20/page) Only if M2
    shows date filters on last-visit time are inadequate. fts_main FTS5
    over title, headings, description, body; external-content over
    pages+contents Tokenizer unicode61 with diacritic removal (level 2)
    so Greek tonos and Latin accents fold; prefix indexes for 2 and 3
    characters fts_meta FTS5 over title, URL tokens, domain Trigram
    tokenizer for substring and typo-tolerant matching on short fields
    meta schema version, created time Migrations (trigram and
    contentless_delete need recent SQLite versions; the bundled
    sqlite-wasm should be far newer. Confirm the build includes FTS5, as
    some size-reduced forks disable it \[T\].)

5.2 Query pipeline Parse (hand-written, fully unit-tested): terms,
phrases, -exclude, site:, after:, before:, when:, is:saved, is:snippet.
Output an AST. Invalid operators become literal text. Filter in SQL on
pages (domain match includes subdomains; date on last_visit; flags).
Match with FTS5: all terms required, last term as prefix, phrases
honoured, exclusions applied. Retrieve the top \~200 by bm25() with
per-column weights (title \> headings \> description \> body). Re-rank
in TypeScript (below), return top 50. Relax if fewer than \~5 results:
switch to any-term matching for words ≥3 characters, then query fts_meta
with trigrams; mark results as "approximate". Suggest corrections for
zero-hit terms using fts5vocab plus a small edit-distance routine
(distance ≤2), shown as "Did you mean". Snippets for the top results via
FTS5 snippet() using private-use delimiter characters, converted to
highlight ranges. No HTML is ever produced (§8). 5.3 Ranking score = a ·
norm(bm25_weighted) + b · titleOrUrlTermHit + c · exp(-ageDays / τ) //
recency, τ ≈ 45 days \[TUNE\] + d · log1p(visit_count) + e · isSaved + f
· exactPhraseHit Starting weights are guesses; they are tuned against
the relevance eval set (§10), not by feel. Keep each term independently
unit-tested. No per-user learning in V1.

5.4 Languages Folding and Unicode word splitting via unicode61. Prefix
matching stands in for stemming, so Greek inflection ("βιβλίο" vs
"βιβλία") is only partly handled. Evaluate a light Greek
suffix-stripping option on the eval set (post-V1 if useful). Stemming
(Porter) is English-only in FTS5; do not enable globally. CJK has no
word segmentation in unicode61; trigram works for 3+ character strings.
Documented as limited in V1. 5.5 Size and speed levers (benchmarked in
M0 and M2) Cap indexed text per page (\~50 KB). Optional compression of
stored body text with CompressionStream; if used, the FTS table must not
need to re-read content for snippets (generate snippets in TypeScript
for the top 50 instead). PRAGMA tuning (page size, cache size),
incremental auto-vacuum. Batch inserts in transactions of \~100 pages.
Warm path: keep the engine alive while the UI is open; close after idle.
5.4b Engine interface (so the engine is swappable) SearchStore offers:
upsert pages (batch), upsert content, add snippet, delete by URLs /
domain / date range / everything-except-saved, search(query),
suggest(term), stats, export, import, maintenance, migrate. A
MiniSearchStore implements the same interface as the fallback (titles,
URLs, and the first \~2 KB of text, in memory with a persisted snapshot)
and doubles as a fast reference implementation in unit tests.

5.6 Decision rule for the engine (M0) Pick SQLite FTS5 if, on synthetic
corpora of 5K, 20K, and 50K pages (realistic text lengths):

p95 query ≤ 100 ms at 20K pages with filters; cold open of the engine ≤
300 ms (warm ≤ 20 ms); DB ≤ 2× text size; 24 hours of simulated indexing
without corruption or unrecoverable errors; worker memory ≤ 150 MB at
20K pages. Otherwise use MiniSearchStore with documented caps and
revisit. 5.7 Semantic search hooks (not built in V1) Reserve: a chunks
concept in the schema design and a vectors store behind an interface. Do
not create them in V1. Spike conditions are in Research §5.1.

6.  Extraction and capture policy Extractor output: normalized URL,
    canonical URL, title, meta description, headings (h1 to h3), main
    readable text (Readability on a cloned document, falling back to
    visible text), language, text hash, byte length, and a skip reason
    if any. Hard caps on every field. Control characters stripped.
    Repeated tokens collapsed (anti-poisoning).

Skip rules (pre-injection, in the service worker): not consented;
feature off; paused; incognito; scheme not http/https; private network
host; user or default exclusion list; token-like query parameters; seen
within 24 h with unchanged hash; storage cap reached. Skip rules (in the
extractor): password field present; payment-card autocomplete fields;
document.contentType not HTML; text under a minimum length (store title
only); text over cap (truncate).

Single-page apps / infinite scroll: use tabs.onUpdated URL changes;
re-extract after a debounce; accept partial capture (documented limit;
competitors have the same limit \[T\]).

Safety: extractor never injects UI into the page, never reads cookies,
storage or form values, and never makes requests.

7.  Messaging and module boundaries All cross-context messages are typed
    and validated at both ends with a schema library (zod or valibot).
    Check sender.id === runtime.id; for messages from injected scripts
    check sender.tab and the URL; ignore anything else. The overlay
    iframe never trusts window.postMessage from the host page. The host
    page and iframe communicate only via a one-time, extension-created
    MessageChannel or via runtime messaging, never through events the
    page can observe. Pure core: engine/, capture/policy, search/parser,
    ranking have no chrome.\* imports, so they run in Node tests. A thin
    adapter layer wraps Chrome APIs. Ports: UI ⇄ engine over a named
    Port. Service worker ⇄ engine over runtime.sendMessage (messages
    from the offscreen document reset the service worker's timers
    \[V\]\[S2\]).

8.  Security and privacy architecture 8.1 Threat model (V1) Threat
    Mitigation Malicious or compromised page tries to read the user's
    search query Overlay is a cross-origin extension iframe; page cannot
    see its DOM or key events. No in-page rendering of results.
    Malicious page content poisons the index or injects markup Treat
    extracted text as data. Size caps, control character stripping,
    repeated-token collapse. Rendering via DOM text nodes only;
    highlights from index offsets; ESLint ban on innerHTML /
    dangerouslySetInnerHTML SQL injection Parameter binding only; parser
    outputs an AST, never raw SQL fragments; fuzz tests Page enumerates
    or detects the extension WAR limited to search.html and assets;
    evaluate use_dynamic_url; accept that a fingerprint is possible Data
    exfiltration (by a bug or a compromised dependency) CSP connect-src
    'none'; network APIs banned by lint; e2e request recorder; pinned
    and audited dependencies; no remote code Supply-chain attack on
    build Lockfile, npm audit / OSV scan, minimal dependency list,
    reproducible build notes, 2-Step Verification on the developer
    account \[V\]\[S12\], protected main branch Another user of the same
    OS profile reads the data Same exposure as Chrome's own History for
    that profile. See encryption ADR below. Extension sold or taken over
    Public ownership statement, open source, versioned consent that
    re-prompts on practice changes Shoulder-surfing during screen share
    One-click pause and a "hide previews" option (post-V1) 8.2
    Encryption at rest, ADR-007 (open) Store FAQ line says data must be
    "stored at rest using a strong encryption method such as RSA or AES"
    \[V\]\[S14\]. Policy text mandates "secure handling, including
    transmitting via modern cryptography" \[V\]\[S12\]. Local-only
    competitors appear to publish without app-level encryption \[I\].
    Options: (A) no app-level encryption; rely on OS disk encryption and
    profile isolation; document honestly. (B) Encrypt only Saved items
    with a device key (little real protection, breaks full-text search
    of them). (C) Encrypt the whole database through an encrypted SQLite
    build (for example a SQLite3 Multiple Ciphers WASM build; unverified
    that a suitable, small, maintained build exists). (D)
    Passphrase-derived key, strongest and most annoying. Plan: ask
    Chrome Web Store developer support before M9 whether the FAQ line
    applies to local-only storage; choose A if not required, otherwise
    investigate C with a go/no-go on size and performance. Do not claim
    "encrypted" in marketing unless implemented. If no key ever leaves
    the profile, state the limits plainly. 8.3 Privacy controls
    expressed as architecture Mirrored deletion and expiry heuristic
    (§4.6). Ledger reads straight from the database; deletion cascades
    through contents, FTS, snippets (except saved). Delete everything
    drops and recreates the database file and clears settings. No
    identifiers: no install ID, no user ID, no timestamps beyond what
    the feature needs. Diagnostics export includes counts, versions and
    error codes only, never URLs or text.

9.  Reliability Service worker: all listeners registered synchronously
    at top level; no globals; terminates at will \[V\]\[S2\]. Offscreen
    lifecycle: getContexts to check existence, a promise lock to avoid
    double creation (the docs show this pattern \[V\]\[S3\]), recreate
    on demand, close after idle. Database ownership: exactly one worker
    holds the OPFS connection. A heartbeat and an exclusive lock detect
    zombie owners after crashes. Migrations: numbered, forward-only,
    each tested against a fixture database from the previous version; a
    database newer than the code opens read-only with an export option.
    Corruption path: integrity check on schedule; on failure show a
    recovery screen offering export of Saved items and reset.
    Backpressure: bounded work queue; indexing yields to search.
    Resumability: history import cursor, reconcile job, and idempotent
    upserts mean any interruption is harmless.

10. Testing strategy Layer Tools What it proves Unit Vitest, fast-check
    (property tests) Query parser, URL normalisation, date parsing,
    ranking terms, capture policy, extractor output on HTML fixtures,
    retention logic Integration (Node) Vitest with sqlite-wasm in
    memory, fake-browser or hand-written typed Chrome stubs Engine
    behaviour, migrations, deletion cascades, import and export,
    relevance eval Component Testing Library for Preact, axe-core UI
    states, keyboard nav, accessibility, IME handling, hostile titles do
    not execute End-to-end Playwright with a persistent Chromium context
    and --load-extension; local HTTP fixture server Onboarding, import,
    live indexing, search, overlay on varied pages, Remember, snippets,
    deletion mirroring, service worker kill and restart, offscreen
    restart \[T\]\[S36\] Privacy and policy Custom tests Manifest
    permission allowlist snapshot; CSP assertions; zero external
    requests recorded from all extension contexts; lint bans on fetch,
    XMLHttpRequest, WebSocket, sendBeacon, dynamic import() of URLs,
    eval, innerHTML; bundle contains no remote URLs except documentation
    links Performance Node benchmarks, browser benchmarks, size-limit
    Budgets in §11 enforced in CI with tolerances Relevance eval JSONL
    of {query, expected URLs} plus a script hit@1, hit@5, MRR on (a) a
    synthetic public corpus in CI and (b) your own browsing corpus
    locally only, never committed Playwright notes \[T\]\[S36\]:
    extension tests need a persistent context with
    --disable-extensions-except and --load-extension; the service worker
    URL gives the extension ID; some guides say headed mode is the
    reliable default and new headless works for MV3. Chrome-level
    keyboard shortcuts cannot be pressed by Playwright, so tests trigger
    the same handler through a test hook. Optional host permission
    prompts cannot be clicked either, so a test build declares the host
    permission as required (build mode flag); the production manifest is
    verified separately by the snapshot test.

11. Performance budgets (proposed, to be replaced by measurements)
    Metric Budget Query p95, 20K pages, with filters ≤ 100 ms Overlay
    visible and accepting input (warm) ≤ 150 ms Engine cold start ≤ 300
    ms Extraction per page (p95) ≤ 100 ms Page-load impact Not
    measurable (post-load idle) Engine worker memory at 20K pages ≤ 150
    MB Database size ≤ 2× extracted text Package size As small as
    possible; target ≤ 5 MB (SQLite WASM \~1 MB class \[I\])

12. Technology stack and repository layout Concern Choice Runtime Node
    22 LTS, pnpm Extension framework WXT (Vite) with TypeScript strict.
    WXT's own comparison rates Plasmo and CRXJS as less maintained
    \[T\]\[S36\]; a hand-written manifest with plain Vite is a fine exit
    path UI Preact, plain CSS with custom properties (light and dark),
    no CSS-in-JS Engine @sqlite.org/sqlite-wasm (confirm FTS5 enabled),
    opfs-sahpool VFS Extraction @mozilla/readability; linkedom or jsdom
    in tests Validation zod or valibot Tests Vitest, fast-check, Testing
    Library, Playwright, axe-core Lint and format ESLint
    (typescript-eslint, custom restrictions), Prettier CI GitHub Actions
    (free for public repos) Docs and policy hosting GitHub Pages (free)
    / (repo root) src/ background/ service worker: router, commands,
    menus, alarms, policy engine/ offscreen host, worker, store, schema,
    migrations, search, ranking capture/ history import, live updates,
    extractor, capture policy ui/ search page, overlay host, onboarding,
    options, ledger shared/ messages, types, settings, i18n, url utils
    tests/ unit, integration, e2e, fixtures (HTML pages), eval (queries,
    corpora) docs/ ADRs, privacy policy source, threat model, spike
    reports, verify-build guide scripts/ corpus generator, benchmarks,
    manifest snapshot, release

13. Build, CI/CD, release CI on every PR: install (frozen lockfile),
    lint, typecheck, unit and integration, build, manifest and CSP
    snapshot tests, size-limit, e2e (headed Chromium under xvfb),
    dependency audit, CodeQL. Nightly: performance benchmarks with trend
    tracking, relevance eval. Release: tag → CI builds the zip →
    attaches zip, SHA-256 and source tarball to a GitHub Release →
    upload to the Chrome Web Store dashboard (manually first; the
    store's publishing API v2 with upload, publish, fetchStatus, and
    setPublishedDeployPercentage exists for later automation and staged
    rollout \[V\]\[S15 nav\]). Document a "verify this build" procedure
    for technical users (pinned toolchain, lockfile, expected hashes).
    Versioning: SemVer; every release notes any change in permissions or
    data practices (which also triggers a new consent version).

14. Architecture decision records to create (statuses) ADR Topic Status
    Decided in 001 Tiers and permission model Accepted M0 (verify review
    impact) 002 Search engine (SQLite FTS5 vs MiniSearch) Open M0 003 UI
    surface (iframe overlay + window fallback) Open M0 004 SW-driven
    extraction vs declarative content scripts Accepted M1 005 No
    telemetry; local diagnostics Accepted M1 006 Deletion mirroring and
    expiry heuristic Open M0 007 Encryption at rest Open Before M9 008
    No semantic search in V1 Accepted M1 009 Framework choice (WXT)
    Proposed M1 010 CSP lockdown and lint-enforced no-network Proposed
    M1 011 Minimum Chrome version Open M0

15. Spikes to run in M0 (answers needed before building) Do optional
    broad host permissions avoid the in-depth review banner? (draft
    upload) SQLite WASM + opfs-sahpool in an offscreen worker:
    stability, cold start, memory, size, and FTS5 availability.
    Benchmarks at 5K, 20K, and 50K synthetic pages: MiniSearch vs FTS5.
    Does onVisitRemoved fire on Chrome's automatic expiry? Can the two
    be distinguished? Does Chrome accept connect-src 'none' and
    default-src 'none' in extension_pages CSP? Overlay iframe: works on
    strict-CSP sites (e.g., GitHub)? Is page CSP frame-src a blocker for
    extension iframes? Focus return and key isolation confirmed?
    use_dynamic_url usable? Default shortcuts: conflicts on Windows,
    macOS, Linux; detection via commands.getAll. history.search
    behaviour at scale: paging strategy, maximum practical maxResults,
    time to import 100K rows. Accent folding and prefix behaviour on
    Greek text with unicode61. Minimum supported Chrome version and the
    test matrix.

------------------------------------------------------------------------

# IMPLEMENTATION_PLAN.md

Purpose: break the build into milestones that separate coding sessions
can complete autonomously, with checkable acceptance criteria and tests.
Date: 2026-10-03 · Read first: PRODUCT_SPEC.md, ARCHITECTURE.md.
Evidence and risks: PRODUCT_RESEARCH.md. Session counts and sizes are
rough guesses \[I\], not commitments.

1.  How to run this plan 1.1 Rules for every coding session Load context
    in this order: PRODUCT_SPEC.md, ARCHITECTURE.md, this file's section
    for the milestone, docs/HANDOFF.md (once it exists), relevant ADRs.
    Build only the milestone's in-scope items. Anything else goes into
    docs/HANDOFF.md as a follow-up. Do not add a permission, a
    dependency with network behaviour, or a new data practice without an
    ADR and an update to the policy checklist (§4). Write tests first
    for pure logic; add end-to-end tests for every user-visible
    behaviour. Leave CI green, the manifest snapshot intentional, and
    docs/HANDOFF.md updated. 1.2 Common definition of done (applies to
    every milestone) Type-checks in strict mode; lint clean (including
    the network, innerHTML, and eval bans once they exist). All tests
    for the milestone pass in CI; no flaky retries added to hide
    failures. Performance budgets from ARCHITECTURE.md §11 not regressed
    (once measured). Permission set and CSP unchanged or changed with an
    ADR and a snapshot update. No TODO without a linked issue.
    CHANGELOG, relevant ADRs, and docs/HANDOFF.md updated (what was
    done, what is next, known issues, decisions needed). Accessibility
    checks pass for any UI touched. 1.3 Dependency graph M0 spikes ──►
    M1 foundation ──► M2 engine core ──► M3 history pipeline ──► M4
    search UI │ │ │ ├──► M7 overlay ▼ ▼ M5 remember & snippets ──► M6
    deep search ──► G1 (dogfood) │ M7 overlay
    ───────────────────────────────┤ ▼ M8 trust & hardening ──► M9 store
    readiness ──► M10 beta ──► G2 ──► public M6 depends on M5 (it reuses
    the extractor), M7 depends on M4, and M7 can run in parallel with M5
    and M6.

1.4 Gates Gate When Decision Stop or re-scope if G0 After M0 Is the
design viable? The engine fails its criteria and the fallback is
unacceptable; the store shows an unworkable review path with no
history-only fallback; the overlay is unworkable (then ship the popup
window only; this is not a stop) G1 After M6, with 2+ weeks of
dogfooding while M7 and M8 proceed Is it genuinely useful to you? You do
not find things you otherwise would not; budgets unmet; any
sensitive-data incident G2 After M10 beta Should it go public and should
you keep investing? Opt-in rate, week-3 retention, or wedge clarity miss
the bars in PRODUCT_RESEARCH.md §8; then ship as a small open-source
tool and stop investing 2. Test fixtures used throughout A fixture HTML
set served by a local HTTP server (names are suggestions): news article,
long blog post, documentation page, forum thread, e-commerce product
page, client-rendered single-page app that changes URL, infinite-scroll
feed, login page with password field, payment form with card fields,
bank-like page, webmail-like page, localhost/private-IP page, page with
token in the query string, very large page, near-empty page, Greek page
with accents, right-to-left page, page with iframes, page with a hostile
title (markup, script-like text), page with strict CSP, page with a PDF
link, page that steals focus on load. A synthetic corpus generator
produces 5K, 20K, and 50K realistic-length documents with a Zipf-like
vocabulary (license-safe or generated text only).

3.  Milestones M0. Spikes and decision records (G0) Size: S--M (1--2
    sessions) · Depends on: nothing · Output is throwaway code plus
    documents. This is the first time any repository is created; keep
    spike code in a clearly separate folder or scratch repo.

Objective: answer the open technical and policy questions before
committing to the design.

Scope

Permission and review spike: minimal MV3 extension with history,
activeTab, scripting, offscreen, and optional_host_permissions; create a
Chrome Web Store developer account (one-time fee) and upload a draft (do
not publish) to see warnings and whether an in-depth-review banner
appears. Also create the listing's privacy fields to see the data-type
checkboxes. Engine benchmark: sqlite-wasm (confirm FTS5) with
opfs-sahpool in an offscreen-hosted worker vs MiniSearch, on 5K/20K/50K
synthetic pages. Measure cold start, query p50/p95, memory, DB size,
insert throughput, 24-hour soak, behaviour after SW termination and
offscreen close. Deletion semantics: observe history.onVisitRemoved for
user deletion, deleteRange, and (as far as feasible) automatic expiry;
design the heuristic. CSP: does Chrome accept connect-src 'none',
default-src 'none', and the other lockdown directives in
extension_pages? Overlay spike: iframe-in-page host injected on a
shortcut; test on strict-CSP sites, framed pages, fullscreen video;
focus return; key isolation from page scripts; use_dynamic_url;
popup-window fallback on chrome:// pages and the Web Store. Shortcuts:
candidate defaults on Windows, macOS, Linux; detection of unassigned
commands. History import at scale: paging strategy, practical
maxResults, time to import 100K rows. Greek tokenization: accent folding
and prefix behaviour with unicode61. Minimum Chrome version and test
matrix. Light demand check (in parallel): 5 to 10 short conversations
with people who say "I know I saw this somewhere"; check whether
Chrome's AI history search is available on a clean profile in your
market. Deliverables: docs/spikes/\*.md with numbers, ADRs 001, 002,
003, 006, 011 resolved, a go/no-go note for G0.

Acceptance criteria

Each of the ten items has a written result with data or screenshots.
Engine decision rule from ARCHITECTURE.md §5.6 evaluated explicitly;
chosen engine recorded. ADR-006 states the exact deletion and expiry
behaviour to implement. Draft store upload outcome recorded, including
any host-permission banner text. Default shortcut proposal and fallback
behaviour recorded. Tests required: benchmark scripts reproducible from
the repo; soak test log attached.

M1. Project foundation Size: S (1 session) · Depends on: M0

Objective: a production-grade skeleton with guardrails that make later
milestones safe.

Scope

Scaffold WXT + TypeScript strict + Preact, directory layout from
ARCHITECTURE.md §12. Manifest with the permission allowlist and CSP from
§3 (adjusted by M0 findings). Lint rules: ban fetch, XMLHttpRequest,
WebSocket, sendBeacon, eval, new Function, innerHTML,
dangerouslySetInnerHTML, remote URL imports. Typed message layer with
schema validation, and a stub service worker, offscreen document, search
page, onboarding page. Vitest, Playwright fixture (persistent context,
extension ID discovery), local fixture server, axe-core. GitHub Actions:
lint, typecheck, tests, build, snapshot tests, size limit, e2e under
xvfb, dependency audit, CodeQL. i18n scaffold, licence, README,
CONTRIBUTING, SECURITY, issue templates, docs/ with ADR template and
HANDOFF. ADRs 004, 005, 008, 009, 010 recorded. Acceptance criteria

A clean checkout builds and loads in Chromium; e2e test opens the stub
search page and the service worker creates and reaches the offscreen
document. Manifest permission allowlist snapshot test fails if any
permission or host pattern is added. Introducing a banned API in a test
file makes lint fail. CI is green on a fresh clone with cached
dependencies. Tests required: lint-rule tests; snapshot tests; e2e
smoke; CI dry run.

M2. Engine core (pure and headless) Size: M--L (2 to 3 sessions) ·
Depends on: M1

Objective: a tested, benchmarked search engine behind the SearchStore
interface.

Scope

Schema, migrations (numbered, forward-only), SearchStore (SQLite FTS5
per ADR-002, or MiniSearchStore if that was the decision; consider
keeping both). URL normalisation and canonicalisation (strip tracking
parameters and fragments). Query parser and AST (terms, phrases,
exclusion, site:, after:, before:, when:, is:saved, is:snippet). Date
parsing (ISO and relative 7d, 2w, 3m). Ranking with unit-tested
components; suggest for typos; relaxation path. Delete operations (URL,
domain, range, all-except-saved), retention and cap routines, export and
import. Synthetic corpus generator, benchmark harness, relevance eval
harness with an initial labelled query set. Engine worker wrapper
runnable inside the offscreen document (messaging contract finalised in
M3). Acceptance criteria

Parser: 100% of documented syntax covered; property tests show no crash
and no SQL fragment ever reaches the database from user text. Ranking:
each term has a focused test; eval baseline hit@1, hit@5, MRR recorded
in docs/eval/baseline.md. Budgets: on the 20K synthetic corpus, query
p95 ≤ 100 ms with filters; DB ≤ 2× text; memory ≤ budget. If missed, the
plan records which lever (caps, compression, tuning) was applied.
Migrations: upgrade tests from each prior schema version fixture;
downgrade protection tested. Deletion cascades remove rows from content
tables and FTS; saved items survive "delete all except saved". Tests
required: unit, property-based, integration against the real engine in
memory, benchmark thresholds, eval harness run in CI on the synthetic
corpus.

M3. History pipeline and consent gate Size: M (2 sessions) · Depends on:
M2

Objective: history is imported and kept current, correctly and
resiliently, behind a real consent gate.

Scope

Service worker wiring: history.onVisited, history.onVisitRemoved,
runtime.onInstalled, runtime.onStartup, alarms. Offscreen manager
(create on demand with a lock, close when idle) and the validated
message protocol. Consent gate: nothing reads history before consent;
consent is versioned; minimal onboarding page with the history consent
screen (full polish in M8). Paged back-fill with startTime: 0, 7-day
windows, batches ≤1,000, resumable cursor, progress events. Live updates
and daily reconcile. Mirrored deletion per ADR-006. Retention, storage
cap, pause and resume. Stats endpoint (counts, DB size). Acceptance
criteria

With seeded history and local fixture pages, all rows appear in the
database after back-fill, none before consent. Killing the service
worker (via DevTools protocol) mid-import then restarting results in a
complete, duplicate-free import. Closing the offscreen document
mid-operation recovers without data loss. Deleting history entries in
Chrome removes the corresponding rows and leaves saved items alone;
behaviour matches ADR-006 for expiry. Paused state stops all writes.
Tests required: integration tests with Chrome API stubs; e2e with
history.addUrl and history.deleteUrl on fixture pages;
service-worker-kill and offscreen-close e2e; load test with 100K
synthetic history rows.

M4. Search UI (window surface) and shortcut wiring Size: M (2 sessions)
· Depends on: M3

Objective: a fast, accessible search experience in a popup window,
reachable from the shortcut and toolbar.

Scope

search.html in Preact: input, chips, result list, empty and loading
states, index status footer. Named Port to the engine, stale-response
discarding, light debounce. Safe rendering: text nodes only; highlight
ranges applied via DOM construction. Keyboard map from the spec; IME
composition handling; row actions (open, new tab, copy, forget, exclude
site); letter avatars (no favicons). Commands: open-search, toolbar
click; popup window opener; unassigned-shortcut detection. Light and
dark themes; reduced motion. Acceptance criteria

Typing returns first results within the budget on a 20K-page database.
Entire flow is operable by keyboard only; axe-core reports no serious or
critical violations. A page titled with markup or script-like text
renders as plain text and executes nothing. Pressing Enter during IME
composition does not open a result. Opening a result with each modifier
behaves as specified. Tests required: component tests, e2e (open, type,
filter, open result), a11y checks, hostile-title test, performance test
in browser.

M5. Remember and Save snippet Size: S--M (1 to 2 sessions) · Depends on:
M4

Objective: explicit capture that survives history deletion, with
highlight-on-return snippets.

Scope

Context menus ("Remember this page", "Save selection to memory"),
remember-page command, toolbar menu entry. Extractor v1 (Readability
with fallbacks, caps, sanitising) injected via activeTab. Built so M6
can reuse it. Saved records and snippets in the engine; is:saved and
is:snippet filters; result rows for each. Text-fragment link builder
(prefix/suffix handling, length limits, encoding) and
open-with-highlight behaviour. Restricted pages (chrome://, Web Store,
PDFs): store title and URL only (or selection text for snippets) with
clear toasts. Export and import of Saved items (JSON). Acceptance
criteria

On fixtures (article, SPA, iframe page, Greek page), Remember stores
readable text and the page is findable by a body phrase. A saved item
survives "delete all history" mirroring and retention sweeps. A snippet
result opens the source with the passage highlighted on a stable
fixture; on a page that removed the passage it opens the page normally.
Restricted pages show the specified degraded behaviour without errors.
Export then import into a fresh profile reproduces Saved items exactly.
Tests required: unit (fragment builder, extractor on HTML fixtures), e2e
(menus, command, restricted pages), round-trip export/import test.

M6. Deep Search (opt-in content indexing) (then G1) Size: L (2 to 3
sessions) · Depends on: M3, M5

Objective: automatic local indexing of pages the user views, safely,
cheaply, and reversibly.

Scope

Opt-in UI (onboarding screen 3 and a Settings toggle) that triggers
permissions.request from a user click; handles grant, denial, later
revocation (permissions.onRemoved). Capture policy engine (pure,
unit-tested) implementing every skip rule in ARCHITECTURE.md §6,
including default sensitive-domain list, private-network rule,
token-parameter rule, incognito rule. Service-worker-driven trigger
(tabs.onUpdated, tabs.onActivated), dwell logic, SPA URL-change handling
with debounce, dedupe by content hash, daily re-index limit, concurrency
1, rate limiting. Extractor v2 additions: password and payment-field
detection, size caps, control-character stripping, repeated-token
collapse. Per-site exclude and forget; basic exclusion list editor;
basic indexed-sites list (full ledger in M8). Indexing status in the
search UI footer. Acceptance criteria

Fixture matrix outcomes are exactly as specified: article, docs, forum,
SPA, Greek page are indexed; login, payment, bank-like, webmail-like,
localhost, token-URL, incognito, and no-text pages are skipped (or
stored title-only) with the recorded reason. After Deep Search is on, a
phrase from the body of a viewed fixture returns that page with a
highlighted snippet. Extraction never delays page load measurably; p95
extraction time ≤ 100 ms on the typical fixtures. Revoking the host
permission turns the feature off cleanly and shows a re-enable prompt.
Memory and CPU stay within budget during a 1,000-page simulated browsing
session. No request leaves any extension context (the request recorder
from M8 is introduced here as a test utility). Tests required: policy
unit tests (table-driven), e2e over the fixture matrix, performance and
memory run, service-worker-kill resilience, permission revoke test.

G1 starts here: dogfood for two weeks using an unlisted/dev build; keep
a "found it / failed" log.

M7. Spotlight overlay Size: M (1 to 2 sessions) · Depends on: M4 (can
run alongside M5 and M6)

Objective: the in-page overlay experience, with the popup window as a
guaranteed fallback.

Scope

Injected overlay host (closed shadow root with a single iframe to
search.html), focus trap, Esc handling, focus return, click-outside to
close. WAR configuration (use_dynamic_url if validated), no postMessage
trust. Fallback to popup window on restricted pages or on any injection
failure. Handling of fullscreen video, framed pages, pages that steal
focus, strict CSP sites. Acceptance criteria

Overlay opens and accepts typing within the warm budget on the fixture
set and on the manual matrix of 15 real page types (news, GitHub, Google
Docs, YouTube, a PDF, a bank-like site, a local file, the new tab page,
a framed page, a fullscreen video, a login page, a Wikipedia article, a
long forum thread, an SPA, an intranet page). A page script that listens
to all keyboard events never receives the keystrokes typed in the
overlay (test fixture proves it). Esc returns focus to the previous
element. Any failure falls back to the popup window without an error
surfaced to the user. Decision gate: if reliability is poor across the
matrix, ship popup-window only and record that in ADR-003. Tests
required: e2e on fixtures including strict-CSP and framed pages,
key-isolation test, focus tests, manual matrix checklist stored in
docs/qa/overlay-matrix.md.

M8. Trust, privacy, and hardening Size: M (2 sessions) · Depends on: M5,
M6, M7

Objective: everything that makes the privacy promise true, visible, and
verifiable.

Scope

Final onboarding (all four screens), versioned consent with re-prompt
logic. Complete Settings: retention, caps, mirrored-deletion toggle,
exclusions, pause, delete (page, site, range, all), export and import
(everything), diagnostics copy. Ledger view with per-domain stats and
"what is stored for this page". No-network end-to-end test: recorder
over all extension contexts (service worker, offscreen, pages, injected
scripts) asserting zero external requests across a full scenario; fails
CI on any. Encryption decision implemented per ADR-007 (default:
documented threat model, no claim of encryption). Privacy policy and
Limited Use affirmation (source in docs/, published on GitHub Pages);
permissions page; threat model; verify-build guide. Security review
checklist run: XSS surfaces, message validation and sender checks, SQL
parameter use, dependency audit, SBOM, secrets scan. Accessibility audit
and fixes; Greek localisation if chosen. Acceptance criteria

Deleting a site, a date range, and everything each remove data from all
tables and from FTS (verified through the engine and through the
ledger). Changing a data practice bumps the consent version and
re-prompts (tested). The no-network test passes and is a required CI
check. Privacy policy text matches the permissions table and the
dashboard draft; reviewed against PRODUCT_RESEARCH.md §4.1. Security
checklist complete with no open high or critical items. axe-core clean;
manual screen-reader pass recorded. Tests required: e2e for all delete
flows and consent versioning; no-network recorder; policy-to-manifest
consistency test (the permissions listed in the policy equal the
manifest); accessibility checks.

M9. Store readiness Size: S (1 session) · Depends on: M8

Objective: a submission package that passes review the first time.

Scope

Final name checks, listing text (no keyword stuffing, accurate),
screenshots, promo assets, short demo clip, localised listing if
applicable. Dashboard fields: single purpose, per-permission
justifications, remote-code "No", data disclosures and certifications,
privacy policy URL, Limited Use statement on the project site. Reviewer
test instructions (how to exercise History search, Remember, and Deep
Search including the permission prompt, with a sample set of pages).
minimum_chrome_version from ADR-011; release pipeline producing zip,
checksums, source tarball, GitHub Release. Visibility set to unlisted
for the first submission; trader or non-trader declaration decided;
support contact. Rollback and staged-rollout notes. Acceptance criteria

A full dry-run submission is accepted (unlisted), or every rejection
reason is fixed and resubmitted. Listing text, dashboard disclosures,
privacy policy, and observed behaviour are consistent, checked line by
line using a checklist in docs/store/consistency-checklist.md. Release
artifacts are reproducible from the tag. Tests required: consistency
checklist; release pipeline dry run; install-from-store smoke test on a
clean profile on each OS.

M10. Beta and validation (G2) Size: calendar-bound, 2 to 4 weeks ·
Depends on: M9

Objective: learn whether people use it, trust it, and keep it, then
decide.

Scope

Unlisted beta to 20 to 50 testers (including people in markets without
Chrome's AI history search, and non-English speakers). Onboarding
survey, week-1 and week-3 surveys, a few 20-minute interviews, a "found
it / failed" diary. Optional "Copy diagnostics" paste (counts only).
Weekly bug triage and release cadence; keep a visible changelog. Public
launch kit: README, project site (GitHub Pages), short demo, FAQ, issue
templates, support policy, a plan for early reviews and questions.
Acceptance criteria (G2 bars, tune before starting)

Deep Search opt-in ≥ 40% of testers after the explanation. ≥ 40% still
searching weekly in week 3. ≥ 60% report finding something they would
not have found otherwise. Relevance eval hit@5 ≥ 70% on the
tester-contributed query set (queries and expected-page descriptions
only, never URLs or text). No open data-loss, privacy, or
sensitive-capture bugs. Testers can name why they chose this over
Chrome's own and similar tools. Outcome: record the G2 decision. If bars
are met, switch visibility to public and plan V1.1. If not, publish as a
small open-source tool, stop investing, and record lessons.

4.  Policy and privacy checklist (re-run at M8, M9, and every release)
    Permissions in the manifest equal the permissions table in the
    privacy policy, the dashboard justifications, and the in-product
    "permissions explained" page. Optional host permission requested
    only from a click, after the explanation. Consent screen is in the
    product, appears before any data handling, and requires an
    affirmative action. Limited Use affirmation is on the project site.
    Dashboard data-type disclosures match actual behaviour; no behaviour
    exists that the policy does not describe. No remote code; no
    obfuscation; minification only. No network use; CSP, lint, and
    recorder tests green. Single purpose statement still true; no
    unrelated feature crept in. Listing text has no keyword spam and no
    anonymous testimonials. Any change to data practices bumps the
    consent version.
5.  Post-V1 backlog (not committed) Item Notes PDF indexing Different
    extraction pipeline; separate milestone Omnibox keyword Cheap, adds
    a surface Edge and Brave smoke testing and an Edge Add-ons listing
    Chromium-compatible Greek stemming experiment Only if the eval set
    shows a gap Hide-previews mode For screen sharing Semantic search
    spike Only with a relevance eval showing lexical gaps; evaluate
    model size, language coverage, idle-only embedding, and delivery
    without a network request (Research §5.1) Collections and tags Only
    if users ask; guard the single purpose User-managed file sync
    (export/import folder) No accounts, no servers Optional paid tier or
    donations Decide stance first; EU trader implications
6.  Kick-off template for each coding session You are implementing
    Milestone Mx: `<name>`{=html} of the project described in
    PRODUCT_SPEC.md and ARCHITECTURE.md.

Read both documents, this milestone's section in IMPLEMENTATION_PLAN.md,
docs/HANDOFF.md, and the ADRs it references. List the files and tests
you will create or change before you start. Implement only the in-scope
items. Do not change the permission set or CSP unless the milestone says
so. Write tests first for pure logic. Meet every acceptance criterion
with an automated test where the plan says one is required. Run the full
test suite, lint, type-check, and build. Fix failures; do not weaken
tests. Update CHANGELOG, ADRs, and docs/HANDOFF.md (done, next, known
issues, decisions needed). Finish with a short summary: what changed,
how it was verified, what is next.
