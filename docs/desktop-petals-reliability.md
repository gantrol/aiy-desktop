# Desktop petal lifecycle

Saved content, machine-local placement and a resident native window have separate lifetimes. A failed window load must not remove content or its saved placement. Hiding a window keeps its editor and follows the existing save guard.

## Opening a window

`PetalWindows` registers a window before navigation so its renderer can request a snapshot. The registered entry can be found immediately; callers must still await its shared load before presenting it.

`loadPetalWindow` completes only after navigation, the native `ready-to-show` event and the renderer's committed-content acknowledgement. These events may arrive in any order. One deadline covers the entire operation, including navigation that remains pending after both paint acknowledgements. Closing the window or a navigation failure also ends the wait.

The caller owns disposal after presentation or failure. Disposal removes event listeners and the deadline, and restores background throttling on a surviving renderer. Every normal flower and note creation path uses this lifecycle. Headless and drawer navigation still have a deadline and close handling, but do not require the flower/note content acknowledgement.

An explicit editor open activates it. A collapsed handoff and saved-window restoration use `showInactive`. Showing always reapplies the current session's pin preference; an explicitly unpinned note stays unpinned.

Flower, note and content-pin windows use `setAlwaysOnTop(flag, 'normal')` on Windows, both before navigation and after presentation. Other platforms retain Electron's `floating` level. The same policy applies to the user's pin toggle and Win+D recovery. It does not add a focus or blur loop; opening an existing window, collapsing it, hiding it and switching libraries retain the session's unpinned choice. Explicitly choosing to pin that content again restores its pin.

In [Electron 43.3.0](https://github.com/electron/electron/blob/v43.3.0/shell/browser/api/electron_api_base_window.cc), the boolean flag selects the native floating/normal Z-order independently of the level string. Its [Windows implementation](https://github.com/electron/electron/blob/v43.3.0/shell/browser/native_window_views.cc) uses the default `floating` string to move the window behind the taskbar when activated. If the taskbar is temporarily non-topmost, [Windows demotes a window placed behind it](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos). The `normal` string bypasses that taskbar placement while `true` still reaches `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)` in the bundled [Chromium 150.0.7871.212](https://github.com/chromium/chromium/blob/150.0.7871.212/ui/views/win/hwnd_message_handler.cc). Native acceptance must verify the `WS_EX_TOPMOST` style and actual visibility after activating another application; mocked window calls alone cannot establish that result.

## Restoring a desktop

Each failed view is logged independently so the remaining batch can continue. The failed view retains its placement and can be opened again.

Before presenting a restored window, `PetalWindows` checks the current placement, drawer ownership, active library and layer visibility. A hide or library drain during loading must not be overwritten by an older restore request. A window deferred during a canceled library drain can resume without recreating its editor, provided its current visibility intent still allows it.

Show-all reads the item ID list once and restores desktop items without activating each editor. It restores only active or temporarily hidden petals with available sources on visible layers. Collected petals and drawer items remain unchanged, and hidden-layer settings are preserved. Opening the flower from the tray remains an explicit open.

## Layout persistence

`PetalLayoutStore` owns validation, state and the serial write queue. `petal-layout-file` owns file recovery and replacement:

- Reads and writes use the same 16 MiB UTF-8 limit. Serialization and size validation happen before disk mutation.
- Each write uses a unique temporary file and asynchronous file synchronization. The previous primary is copied and synchronized to a separate temporary backup, then replaces `.bak`. Only then does the new primary replace the old primary.
- A failed copy does not truncate the existing backup. Temporary files are removed after success or failure.
- Invalid JSON, invalid schema and oversized files are preserved under `.recovery-<UUID>` before trying `.bak`. If neither candidate is valid, the store uses defaults. This does not modify saved content or open all notes.
- File access errors and failure to preserve an invalid candidate propagate; they are not treated as permission to reset state.

Recovery files are retained, and recovery is currently reported through diagnostics. There is no automatic cleanup or recovery-selection UI.

## Renderer refresh

`createCoalescedRefresh` allows one snapshot request in flight and one queued follow-up. A burst of change notifications cannot create overlapping requests. Completed requests are accepted in order so queued changes cannot starve first content. Disposal cancels queued work and suppresses callbacks from a failed in-flight request.

This bounds duplicate requests per renderer. It does not establish a native-window capacity limit, eliminate full snapshots across windows or replace measurements of CPU, memory and input latency. Multi-display placement, native focus, sleep/wake and shell behavior still require platform acceptance.
