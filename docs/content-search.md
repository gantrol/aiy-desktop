# Local saved-content lookup

The sidebar's **Search** view follows **Gallery** and opens a full workspace page. Ctrl/Cmd+Shift+F navigates to it in the active workspace group using the normal navigation guard. Search participates in tabs, history, split views and workspace restoration; its query and content-type filter are saved in the workspace location. Selecting a result verifies that its current content is still active and readable, then opens it in a new tab.

The search workspace fills the available width. Its input and content-type filters sit above a bounded result list. Empty input shows recently changed content. Results show type, match evidence, date and source identity; indexing coverage and pause/resume controls stay below the list. Search does not render a separate read-only document surface. Articles, social posts and video documents open in the same editable creation or document workspace used by their library entries, so search cannot introduce a second rendering or interaction contract.

Titles, snippets and source IDs highlight literal query terms. Matching follows the search query parser (including quoted phrases) and preserves stored spelling and Unicode grapheme clusters. Indexed link destinations or image descriptions can match a result even when the evidence snippet does not contain visible text from that field.

Arrow Down/Up enters the first/last result from the input. Within the list, Up/Down and Home/End move focus. A click, Enter or double-click opens the focused result's current content in a new tab; Enter in the input opens the first result. Ctrl/Cmd+F focuses and selects the search query. Escape returns focus to search; in a nonempty search input it clears the query. These shortcuts respect IME composition. Pagination controls remain mounted during requests so keyboard focus survives page changes; new queries and pages reset list scrolling.

Opening a result uses the normal creation/document location mapping rather than a search-only reader. A failed authoritative read leaves the search results available for another attempt.

`AppSidebarButton` owns navigation-rail styling and tooltips for views, search and settings. The sidebar and app menu share the core `navigationItems` from `app-navigation-items.ts`; search follows gallery in that list. Plugin shortcuts, including Codex and the transition showcase, are provided separately by `extensions/extension-navigation-items.ts` and remain gated by plugin availability and the existing display settings. Route types live in `app-navigation.ts`. The rail scrolls independently while its space switcher and settings remain available.

The same lookup is used by the reference picker's **Works** category. Album and creation-item pickers keep their existing metadata search; legacy `contentLibrary.search` remains compatible. This is not yet an all-asset or all-library search replacement.

## Indexed scope

Active saved articles/notes, social posts and current video-document branch revisions in the current space. It reads through the existing content repository, including packed article revisions. It does not scan source folders, decode video, run Blender, OCR images, search unsaved editor buffers, or call a model.

Queries are literal: whitespace means AND, double quotes group phrases, normalization uses NFKC and lowercase without changing stored content. SQL and FTS grammar are never accepted from input. One- and two-character Chinese terms remain searchable. No pinyin, spelling correction, simplified/traditional conversion, semantic matching or regex is implied.

Readable Markdown text and explicit link/file destinations are indexed. Escaped punctuation in legacy plain-text posts is not treated as an extra user character. Unquoted network paths retain their backslashes. Evidence snippets preserve the original spelling and do not bisect Unicode graphemes. Matching a link's text does not fetch that page or infer its contents.

Results distinguish exact identity, title and text evidence. Filters and matching precede pagination. Same-titled works retain separate identities. A current-source/revision join excludes stale, removed, inactive and empty-branch rows even while rebuilding. Opening current content performs the same authoritative active/readable check before navigation. A changed query/index/library snapshot restarts pagination instead of silently mixing rankings.

The results use bounded 30-item pages with Previous/Next. The search tab retains its query, page, scroll position and focus while an opened result uses its own tab. Composition, hidden windows and inactive workspace groups/tabs stop new preparation requests. Already executing synchronous reads cannot be forcibly interrupted. Responses from an old query cannot replace the current results. The English and Chinese catalogs share the same parameterized coverage messages.

## Derived state and limits

The cache uses SQLite TEMP tables and FTS5 trigram on the open library connection, with no persistent content migration. TEMP is not a promise of RAM-only storage: SQLite may spill temporary data. It is not a backup and is rebuilt after reopening. Index preparation is lazy and advances only while search is open and visible. Each batch reads at most 16 sources with a soft 30 ms budget checked between sources; a single source read can exceed that budget.

At most 250,000 UTF-16 units per source body and 8 Mi UTF-16 body units in the session are indexed. Larger bodies retain title/ID matching and report limited coverage; they are not silently truncated. Title/FTS overhead is additional. Short queries can scan normalized indexed text, so these limits are not a large-library latency guarantee. Unreadable source counts and pending work remain visible. Pause stops preparation; retry queues failed/limited sources again. No content mutation or change event is produced by search.

Opening current video content goes to its document workspace; it does not promise an exact timestamp/branch deep link. Search results do not adopt references or restore collected petals.

## Validation

Keep detailed search regressions in the private harness, outside the public-source test boundary. Exercise old matches beyond the newest page, one/two/three-character Chinese queries, quotes and SQL/FTS punctuation, revision changes, removal, unreadable/oversized sources, two-library isolation, repeated retries and stale pagination.

The full project format, lint, typecheck, startup/storage, test-boundary and build gates remain unchanged. Detailed regressions belong in the independent private test repository, not in this product repository or a product-repository review branch. The component workbench is `npm run design:dev` → `/search.html`; `?locale=en` changes language and `?partial=1` shows incomplete-coverage feedback. Its synthetic IPC validates presentation only; SQLite integration requires the private harness.
