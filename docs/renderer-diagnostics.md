# Renderer diagnostics

AIY writes local JSONL diagnostics under `<userData>/diagnostics/renderer/`.
The default desktop development path on Windows is
`%APPDATA%/AIY/diagnostics/renderer/`. A configured user-data directory or Store
installation uses its own user-data root.

`renderer-current.jsonl` rotates at 2 MiB into `renderer-previous.jsonl`. Only
these two files are retained. Writes are asynchronous, serialized, and limited to
256 KiB of queued records. A later record's `dropped` count reports discarded
records. Normal service shutdown waits up to 500 ms for pending writes; forced
process termination or a broken filesystem can still lose pending records.

Records include wall-clock time, process ID, and an event name. Renderer events
also include a `pageId` and monotonic `elapsedMs`. Each reload creates a new page
ID. Save operations carry a request ID; editor events carry a mounted session ID
and post ID. Request IDs are local to their layer: correlate editor saves and IPC
requests by page ID, post ID, and time.

## Blank pages

The main process records window creation, navigation, DOM readiness, completed or
failed loading, preload errors, console errors, unresponsive windows, and renderer
process exits. This remains available when the renderer entry module cannot run.
The renderer records entry, page exit, uncaught exceptions, unhandled rejections,
and React's uncaught, caught, and recoverable errors. These hooks report errors;
they do not change application recovery or reload behavior.

Error records contain a category, error type, message length, and bounded code
stack frames. Raw error messages, arbitrary rejection objects, URL query strings,
console payloads, document titles, body text, and typed characters are not logged.
Unclassified errors use `other`; their code locations can still identify the
failing path. Console-only failures retain the source filename and line number.

## Social post editing

The editor records mounts, unmounts, incoming post revisions, committed content
changes, dirty/saving/failure state, focus, and composition boundaries. Input
summaries contain cumulative key, native input, and React change-handler counts;
summaries are coalesced over 250 ms. `draftSequence` counts committed content
object changes, including incoming replacements; it is a diagnostic counter, not
a persisted revision. Development StrictMode can replay mount/effect records.

The expected save sequence is `post-save-start`, `post-ipc-start`,
`post-ipc-success`, `bootstrap-start`, `bootstrap-success`, and
`post-save-success`, with state/prop events interleaved. The IPC and bootstrap
layers emit one `*-slow` record after five seconds without settlement and record
failure or success with elapsed time. A skipped save distinguishes content that
matches the saved baseline from a save already in flight. Lengths and image counts
describe snapshots without retaining their content.

Compare key/input/change counts with committed state and composition events when
text stops responding. Compare the last save stage with the next page's lifecycle
when reloading produces a blank page. These records support diagnosis; a missing
event alone does not prove a particular cause.
