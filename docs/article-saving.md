# Article saving

The editor owns the live document and undo history. Its session owns metadata,
an increasing draft sequence, and the last acknowledged revision. A save response
advances that baseline without loading content back into the editor.

## One save queue

`AutoSaveCoordinator` captures an immutable snapshot of content, element placements,
and comment anchors. Each edit replaces the queued snapshot. The session stays dirty
until the database acknowledges that snapshot's sequence, including edits that only
change placements or anchors.

Idle autosave, explicit save, Ctrl/Cmd+S, lifecycle flush, retry, and history restore
use this queue. Explicit save captures the current editor state; lifecycle flush
drains captured changes without inventing an edit. Recovery checkpoints receive
the same captured snapshots, including explicit saves and restores.

Only one request can be in flight. Each request captures the article, session,
draft sequence, expected revision, content hash, and request ID. A failed request
with an uncertain outcome is retried unchanged before any newer snapshot is sent.
That retry establishes the persisted baseline for the next request. A new edit or
explicit retry can resume a failed queue; a real revision conflict stops it.

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
