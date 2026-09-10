# Content applications

Content applications are optional tools behind a collapsed application-name button in the desktop note. The album and editing controls have their own row. Opening an application mounts its controls; one shared note subscription keeps the task indicator current while its controls are collapsed. Multiple registered applications use a selector inside the expanded area. Project, model, and reasoning controls belong in the selected application's bounded settings panel. Writing and saving notes do not require Codex. The host currently provides the `codex.content` adapter.

## Contribution and adapter

A capability manifest declares its application IDs in `contributes.contentApplications`. The host must also register a `ContentApplicationAdapter` for each ID. A manifest declaration alone cannot execute code, introduce renderer markup, or choose an IPC channel.

The main-process registry returns `id`, `extensionId`, localized `name`, `available`, and `missingPermissions`. `window.desktopPetals.externalApplications` exposes:

- `list()` to enumerate registered applications belonging to installed plugins.
- `command({ applicationId, command: { kind, ...parameters } })` to dispatch to an adapter. The adapter validates the complete command with its own schema.

The renderer supplies application-specific controls through the `applicationControls` registry in `PetalExternalApplications`. To add Hermes, Claude Code, or another application, declare its contribution, register its main-process adapter, and register a control component that receives only the selected note, save/settle callback, and disabled state. That component owns its provider connection, settings, task state, and result presentation. These providers are not implemented by merely adding a menu item. Unregistered application IDs are rejected; an application without controls falls back to its settings entry.

## Permissions and scope

`library.read:selected-content` authorizes the selected content's title, body, and expanded fixed block references. It is separate from `library.read:selected-references`, which covers attached images, and `library.create:creations`, which covers collecting generated results.

Codex additionally requires the existing app-server, managed-thread, and project-metadata permissions. The content permission is optional in the Codex manifest and is not automatically granted to existing installations. The note shows a permissions action until the required grants are present.

The registry checks activation and permissions at dispatch time. The adapter's service also checks permissions before reading content or executing a task. Revocation stops active Codex content work. A note window can operate only on its own stash; IDs supplied by the renderer are checked against the sender's window.

Opening the plugin settings does not require content access. Adapters may allowlist local configuration commands separately; those commands must not expose the selected body or launch external work. Existing Codex bridge methods remain typed and delegate through the registry.

## Saved content

Execution waits for composition, image imports, and saves to settle. The request identifies the saved content hash; stale content is rejected. Fixed references are expanded from their retained snapshots. The external application receives the selected content and its attachments, without access to a general library or filesystem API.

Each execution starts a standalone Codex task. AIY passes the saved text and ordered image asset IDs in memory, validates the resolved files, sends them as `localImage` inputs, and rewrites AIY asset links in the outgoing Markdown to local file URLs. Source content and original images remain unchanged. Notes do not resume previous tasks or provide a conversation composer; further work opens the original task in Codex. An empty completed turn remains a failure with a distinct code and inspectable details; another execution requires a user action.

AIY persists only execution metadata: source revision and content hash, project and model settings, task and turn IDs, status, errors, and image collection receipts. It does not retain a second copy of prompts or replies in the content-task store. Opening an existing library removes those legacy copies without changing the source note, Codex history, or collected images. Interrupted image collection can still use saved output descriptors and receipts without rerunning the model.

The Codex workspace uses Task history as its default entry, followed by Materials, Usage, and Settings. Task history is the only transcript browser and remains read-only. New note tasks use the user-task source; legacy note task IDs are registered from library receipts in the existing history cache so its user-task filters include them. This provenance table contains IDs only and is cleared with the history cache. Usage investigation owns statistics; the flower center consumes quota state. Neither owns another task history.

## Codex runtime

An explicit `CODEX_BINARY` or injected executable takes precedence. Otherwise, on Windows, AIY checks Codex Desktop's `%LOCALAPPDATA%/OpenAI/Codex/bin` directory and up to 32 versioned runtime directories, probes `--version` with bounded concurrency and timeouts, and selects the newest usable version. If no desktop runtime is available, it uses `codex` from PATH. Discovery is asynchronous, happens only on demand, and is cached for the process lifetime; restart AIY after upgrading Codex. Model discovery, health checks, and task execution use this shared resolution policy.

AIY starts its own `app-server --listen stdio://` process using that executable and the user's Codex sign-in. It does not attach to the desktop app's running private connection. The app-managed installation layout is a compatibility lookup, not a published discovery API; `CODEX_BINARY` remains the override for other installations. A server response requiring a newer Codex is saved as `clientUpgrade` with the original failure details. It does not downgrade the model or replay the task automatically.
