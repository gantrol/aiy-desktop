# Table images in publication candidates

The image-post preparation path converts supported table blocks before showing the publication preview. The manuscript stays unchanged. WeChat **article mode** continues to use the existing HTML table renderer; this conversion only applies to attachment modes (including WeChat image posts).

## Supported input and explicit limits

- Top-level GFM tables with one header row, plain cells, alignment, emphasis, inline code, line breaks, and local static PNG/JPEG/WebP images. Values are rendered as written; there is no model call or numeric normalization.
- Up to 20 tables, 8 columns per table, 1,000 rows including the header, and 128,000 characters of source Markdown. The target's existing attachment limit still applies to the combined original images and generated pages: currently 20 for X/WeChat and 18 for the other supported image targets. These are application limits, not claims about permanent platform capabilities.
- Long tables paginate between complete rows and repeat the header. A page is 600 CSS pixels wide, at most 780 CSS pixels tall, rendered to a 1,200-pixel-wide PNG. Text uses a fixed light background and 24 CSS pixel base font. Selected watermarks occupy a separate 180-pixel footer below the captured table.
- Merged cells, nonrectangular or nested tables, raw HTML tables, multiple block elements in a cell, formulas, unsupported inline markup and animated table media stop preparation. Cells which cannot fit on one page also stop it. Rich article table structure is checked before its Markdown projection is used.
- Tables introduced or changed by expanded content references are currently blocked: frozen reference Markdown does not carry enough rich-cell information to guarantee faithful conversion. Other reference content continues through the existing freeze operation.
- HTTP(S) links retain visible text in the image and show the localized loss-of-clickability status. Other link forms and footnote/reference syntax inside cells are blocked. A picture is not an accessible or machine-readable replacement for table data.

## Candidate identity, ordering and confirmation

Preparation runs through a validated, narrow IPC endpoint. Asset paths are resolved as a set in the expected local space; renderer input cannot request arbitrary filesystem paths. Rasterization uses a hidden sandboxed Electron window, an isolated partition, no external resources, and sanitized HTML. It waits for fonts, image decoding and layout before measuring and capturing pages. PNG encoding uses sharp's asynchronous worker pool. Native bitmap copies are bounded and channel ordering is detected for the current platform.

The generated pages have separate identities for each table occurrence. A table's pages stay contiguous and in page order. Original images follow manuscript order unless a saved channel order is present; insertion uses neighbouring manuscript images and rejects conflicting anchors. The selected leading cover stays first. Whole groups can move earlier/later in the preview, and the same final list produces body image references and upload order. X inherits the existing sequential four-images-per-post thread partition; its preview shows those destinations as well as the sortable full gallery.

The confirmation view shows all final attachment bytes, including selected watermark processing on original images. It allows enlargement and inspection of the captured source table Markdown. Confirmation remains disabled until every preview image loads. Article batches containing converted tables pause before enqueueing or opening any destination; social post batches use their existing preview step. Saving or source-revision checks can stop execution. Failed preparation does not silently fall back to pipe-separated table text.

The main process caches the final bytes for 30 minutes: at most eight candidates and 128 MiB in total. Preparation is serial, has a 90-second timeout, a 48 MiB source/output byte budget and bounded image decoding. Cancellation releases the hidden window and removes unused candidates; expired or restarted previews require fresh preparation. This is not a persistent pre-confirmation draft store.

Execution validates candidate space, source, target, watermark selection, attachment membership, page-group continuity and cover position. It passes the cached bytes directly to the existing handoff store, which persists and hashes those bytes before launching the browser. It does not rasterize again or reread source files. Existing handoff history/reopen behavior retains the staged content. Successful staging is not evidence that a remote platform accepted or ordered every image correctly.

## Verification boundary

Existing unit, component and integration regressions, type checking, scoped lint and production build are the available checks. No table-conversion-specific tests were added. The hidden renderer's actual pixels, pagination readability, font coverage, DPI behavior, cancellation timing and real-site upload/order have not been exercised in this change. No manual UI or real-account operation was performed. These require separate authorized validation; existing regression passes must not be reported as end-to-end table-conversion acceptance.
