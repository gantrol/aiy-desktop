# Article saving

The editor owns the live document, mapped comment ranges, selection, and undo history.
One session model owns metadata, comments, the draft sequence, and the acknowledged
article. A save response advances that baseline without loading content back into
the editor. React components subscribe to projections of this model.

## Stable document handoff

The editor publishes Markdown, element placements, and comment anchors together.
Composition has an explicit pending phase. Auxiliary identity and decoration work
waits for composition to settle. Save and lifecycle operations wait for the stable
publication; a departing editor hands off its committed snapshot before detaching.
Uncommitted composition text does not become a saved draft.

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
