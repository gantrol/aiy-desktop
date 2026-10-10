# Embedded web runtime

The optional **Embedded Web Runtime** capability (`com.aiy.embedded-web`, version `0.1.0`) starts disabled. Enabling it permits scripts when the user opens an HTML result in Codex visualizations or an imported outline web page. List thumbnails and unopened outline nodes never execute scripts. Disabling the capability or revoking `browser.execute:local-html` stops the running page; reopening a preview uses the static path.

The application remains at `0.5.10`. No database migration is required. The package is discovered through the existing bundled extension directory and uses its own version.

## Execution boundary

- The main process issues a preview lease after checking the source and runtime capability. Codex results require the Codex extension; imported files require the current space and an available immutable HTML object. The renderer passes only this identifier and the visible bounds, never an arbitrary URL or filesystem path.
- Executable HTML is served only through the dedicated in-memory Electron session. The ordinary renderer session cannot load executable leases. Each lease has a random origin; the response CSP uses `sandbox allow-scripts` without same-origin privileges.
- `WebContentsView` has Chromium sandboxing, context isolation and web security enabled. It has no preload or Node integration, and cannot access the application's IPC or DOM. The view is placed inside the existing preview dialog and follows its viewport bounds and zoom.
- The session blocks requests except GET/HEAD resources belonging to the active lease. CSP denies connections, frames, workers, forms, plugins, external fonts and remote images/scripts. Inline scripts and bounded local JS/MJS resources are allowed. Inline styles and in-memory images are allowed.
- Navigation, redirects, popups, downloads, device access and browser permissions are denied. Offline emulation, a fixed loopback discard proxy and the non-proxied UDP restriction provide additional network barriers, including WebRTC transports not covered by CSP alone. There is no network allowlist editor in this version.
- Closing the dialog, pressing Escape in the page, losing the lease, disabling the source/runtime, disposing the space, renderer failure or becoming unresponsive destroys the view. Host shutdown does not wait for the page's `beforeunload` handler. One page may run at a time.

Resource access retains the existing path, symlink, file-change and size checks. Reads use bounded asynchronous buffers. There are at most 48 resource requests and 24 MiB per lease, including a 4 MiB HTML limit and a 2 MiB limit per local script. A runtime lease expires after one hour; static previews retain their five-minute lifetime.

## Outline import

The outline accepts batches of up to four UTF-8 `.html` or `.htm` files, each no larger than 4 MiB. Validation precedes import; reads and writes are asynchronous and sequential. An import publishes a complete immutable object at `objects/sha256/<prefix>/<hash>.html`. The `htmlFile` inline atom stores only the space ID, object hash and filename, and appears as a clickable filename in a new outline item. The original download is never modified. Closing the editor, changing the target document or switching spaces during import cancels insertion; all inserted items share one undo step. Unreferenced imported objects remain retained for history and undo; this change does not introduce automatic garbage collection or a database migration.

Imported previews verify the stored hash and use at most three in-memory leases per active space, each with an eight-request limit. Only the selected HTML is available; sibling assets, external scripts and remote resources are not imported. Closing the preview releases its lease. Space drain/disposal revokes imported leases and destroys the running view. Enabling the runtime does not require the Codex extension for this source.

Markdown projections use an `aiy-html:` link carrying the space and hash. Article Markdown export and readable content directories copy the HTML into their attachment directory and rewrite this link to the copy. These exported files run under the receiving application's policy when opened outside AIY. The saved outline retains the original node and immutable source; edits performed inside a running page remain temporary.

## Current limits

This is an ephemeral runtime, not a general browser or an HTML project importer. The opaque origin intentionally does not provide localStorage, cookies or IndexedDB. A page must tolerate unavailable storage. Page downloads are blocked, so its export/save buttons cannot save results through the host. Files explicitly selected by the user through a page's file picker are available to that page; it has no unrestricted filesystem access. Source files are never rewritten.

Pages requiring a CDN, remote API, workers, persistent browser storage or downloads need separately designed permissions or adaptation. The host does not promise that arbitrary HTML is compatible or immune to Chromium vulnerabilities. Existing automated checks do not substitute for execution, network-isolation, focus and multi-DPI acceptance of this new view.

Security design references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [Electron session](https://www.electronjs.org/docs/latest/api/session), and [CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox).
