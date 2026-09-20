# Article saving

The editor owns the live document, mapped comment ranges, selection, and undo history.
One session model owns metadata, comments, the draft sequence, and the acknowledged
article. A save response advances that baseline without loading content back into
the editor. React components subscribe to projections of this model.

## Cover ratios

The images panel keeps covers in its first row, separate from body-image ordering.
The shared `coverAssetId` supplies the initial preview for 1:1, 3:4, 4:3, 16:9 and
2.35:1. Optional `coverVariants` select an independent image for each ratio. Each
entry records its cropped asset, original source and pan/zoom settings. Cropping
creates a PNG through the existing image-import pipeline, with a maximum edge of
4096 pixels; it never replaces the source or inserts another image into the body.
Selecting another image, including an upload or a dropped image, opens that ratio's
crop dialog and changes only that ratio after Apply. The fixed crop frame keeps the
surrounding image visible through a dim mask. Drag or arrow keys pan the image;
scroll, the zoom slider, and +/− zoom without moving the image point under the pointer.
Resetting a ratio to the shared cover removes its override.

The source selector offers the article's images and the already loaded images from
its creation item and creation directory, including related generation results and
reference images. The picker uses static thumbnails; only the active crop decodes
its original image. It does not scan the library when opening the article.

The explicit “Use this source for all ratios” switch is off for each new crop dialog.
Applying it replaces the shared source and resets the other ratios to centered
previews in one edit. Cover undo/redo keeps up to 20 changes for the current editor
session and restores the required image bindings. It never rewinds body text or
titles. Loading an external revision or restoring article history clears this local
cover history; durable recovery and revision history continue to own saved changes.

Each ratio also opens its own generation workspace. Optional `coverRatio` travels
with ARTICLE_HEADER in the existing derived-visual target snapshot (`anchor_json`),
selects the matching canvas, and applies only to that slot. Legacy workspaces without
it keep shared-cover behavior. First adoption compares against the revision captured
before generation; the existing conflict comparison lets the user inspect a newer
revision and explicitly apply again. Later generated candidates retain that ratio.
If an explicit ratio's generated pixels do not match its canvas request, adoption
first creates a centered crop through the existing sandboxed image-transform service.
Only a successful, source-checked result is adopted; the original remains bound so
reopening the crop starts from the source. A switched candidate discards late results,
and the revision captured before preparation still guards the final adoption.

Dimension tooltips are references, not upload validation. As checked on 2026-09-19,
[YouTube](https://support.google.com/youtube/answer/72431?hl=en) recommends 3840 × 2160
for 16:9 video thumbnails and [Apple Podcasts](https://podcasters.apple.com/support/5514-show-cover-template)
recommends 3000 × 3000 for show covers. The 3:4, 4:3 and 2.35:1 entries provide only
example dimensions, without claiming unverified platform requirements. Source size
still bounds the exported crop; this editor never upscales it to a tooltip example.

Variants and their source bindings travel through the same revision, autosave,
recovery and restore protocol as the document. Older content without variants
keeps its existing canonical hash. Consumers that request a single cover continue
to use `coverAssetId`; a ratio-specific crop can become the shared cover or be
exported from its image context menu.

## Article drafts and desktop notes

New desktop notes and saved creation inputs own an ARTICLE form in a DRAFT creation
item. The draft phase describes creative progress; it is independent of autosave,
archive state, and desktop placement. A blank desktop note is provisional until
it contains text, a title, an image or an attachment. Pinning an existing article
does not change its phase.

Articles own prose, revision history, comment anchors and attachments. Optional
`creationInput` metadata keeps prompt nodes, term identities, recipe revisions and
parameters, reference images, and generation settings in the same revision.
Continuing a saved input updates that article; explicitly creating another form
still creates another article. The inspiration API is a compatibility adapter.

Main and desktop editors commit through the article revision writer. Desktop
checkpoints retain the expected revision as well as the hash. Article snapshots
retain creation inputs and attachments when editing prose.

Revision 6 migrates legacy inspiration records, revisions, comments, lifecycle
records, file projections and desktop instances in one transaction. Legacy
revision IDs and hashes remain mapped for recovery; old source rows are retired.
Legacy main-editor checkpoints are copied to durable article recovery before
their exact source checkpoint is acknowledged.

## Stable document handoff

The editor publishes Markdown, element placements, and comment anchors together.
Composition has an explicit pending phase. Auxiliary identity and decoration work
waits for composition to settle. Save and lifecycle operations wait for the stable
publication; a departing editor hands off its committed snapshot before detaching.
Uncommitted composition text does not become a saved draft.

New-creation idle checkpoints and explicit draft saves join the save lane before
waiting for composition and image imports. They capture the live document only
after both have settled, then recheck the session, autosave epoch and lifecycle.
Resetting, replacing or releasing the session cancels a pending input wait, even
if the old editor never emits `compositionend`; it cannot hold up the next draft.
An explicitly supplied immutable snapshot keeps its original input.

Starting another creation, resuming a draft and choosing an existing creation
wait for the current save. A save failure leaves the current input open; a newer
navigation command supersedes an older one before it can replace the workspace.
Leaving the workspace, changing location or unmounting also invalidates pending
navigation. Assigning the first saved ID to the same new draft is not a departure.
While the next draft is created or loaded, the current input stays editable; its
last edits are saved again before replacement. A failed load leaves it open.
Navigation also compares the current complete input with the snapshot actually
acknowledged by the database. Edits made during the save response require another
save; only an unchanged acknowledged input permits the synchronous replacement.
First-save ID assignment keeps queued edits in the same session, so text entered
while the initial acknowledgement is pending is not dropped as a stale autosave.
The first unfinished composition or image import also counts as input to preserve,
even before the editor has published text or obtained a draft ID.

The composition controller hands off an ended composition during layout cleanup,
before a parent's passive cleanup preserves the draft. That fallback cancels
pending live captures and reads the last published document and prompt projection
together. It never reads a released view or saves an uncommitted IME candidate.
Switching to the document workspace keeps the composer mounted but hidden; if
input is still pending, its cancellable settled save follows that fallback so the
final publication cannot be replaced by the earlier committed snapshot.

Saving reads the document without changing it. Unavailable local images keep the
draft in a retryable failed state instead of being silently omitted from an
acknowledged document.

## One save queue

`AutoSaveCoordinator` captures an immutable snapshot of content, element placements,
and comment anchors. Each edit replaces the queued snapshot. The session stays dirty
until the database acknowledges that snapshot's sequence, including edits that only
change placements or anchors.

Idle autosave, explicit save, Ctrl/Cmd+S, lifecycle flush, retry, history restore,
comment mutations, and applying check findings use this queue. A comment mutation
first drains document changes, then updates the session's comments against its
acknowledged article. Subsequent document saves run after the mutation completes.
Recovery checkpoints receive the same captured snapshots, including restores.

Only one request can be in flight. Each request captures the article, session,
draft sequence, expected revision, content hash, and request ID. A failed request
with an uncertain outcome is retried unchanged before any newer snapshot is sent.
That retry establishes the persisted baseline for the next request. A new edit or
explicit retry can resume a failed queue; a real revision conflict stops it.
Preparation failures and persistence failures are both visible, retryable states.

## External updates, recovery, and shutdown

A newer external revision replaces a clean session through an explicit document
load. A dirty session keeps its document and presents a conflict. Loading the newer
revision first preserves an independently owned recovery copy of the local draft.
Older article projections cannot roll the application cache back to an earlier
revision. A copy explicitly retained by the user is outside normal save cleanup.

The registry keeps a session alive while its final write is draining. Reopening
the article during that interval acquires the same session. A failed drain keeps
the session available for recovery and retry.

Library switches and window actions proceed only after a successful drain. Native
quit also asks the renderer to finish its write lane before database shutdown;
failure or timeout leaves the application open. A forced process termination
continues to rely on the durable recovery checkpoints already written.

## Database decisions

The main process validates the normalized content hash and decides within one
transaction:

| Submitted snapshot                                                   | Result                                                                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Matches the current content and all submitted placements and anchors | Acknowledge the current revision without inserting another revision. This also handles retries after a lost response. |
| Differs, and the expected revision is current                        | Append a revision and advance the current pointer with compare-and-swap.                                              |
| Differs, and the expected revision is stale                          | Return `REVISION_CHANGED` without changing stored content.                                                            |

History is never a conflict check. Editing A → B → A produces three revisions when
each change is saved. Submitting A again while A is current succeeds without adding
a fourth revision. Restore, system updates, and rename use the same revision writer.

The shared normalization and snapshot comparison functions keep storage decisions
and acknowledgement validation consistent. The renderer validates the response's
request identity and full submitted snapshot before advancing the session baseline.
It never uses a local content hash comparison as a substitute for database acknowledgement.
