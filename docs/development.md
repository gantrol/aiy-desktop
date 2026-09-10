# Desktop development

This document covers engineering workflows for `apps/desktop`. For the product overview and external model dependencies, see the [main README](../README.md).

## Requirements

- Windows 10/11 x64 for packaging.
- Ubuntu 22.04/24.04 x64 for source evaluation (no Linux package is produced).
- Node.js 22 or newer.
- Visual Studio 2022 or Build Tools with the MSVC x64 C++ toolchain, used to compile the Store update helper.

The maintained distribution target is Microsoft Store MSIX for Windows Desktop x64. Ubuntu x64 can run the application from source with the normal npm workflow, but Linux packages are not produced. macOS, Linux, NSIS, portable ZIP, and unpacked directories are not release targets. `electron-builder` is retained only to prepare the temporary Windows payload consumed by the MSIX script.

## Run from source

For a standalone checkout of `aiy-desktop`, run these commands from that repository's root. If the desktop repository is nested inside a larger workspace, first change into the desktop application directory; the workspace root may not contain the desktop dependency lockfile.

```bash
npm ci
npm run dev
```

`npm run dev` installs the Electron version required by the project first. Renderer changes use Vite HMR; main/preload changes rebuild and restart Electron. After changing `electron.vite.config.ts`, stop the dev process completely and start it again so the host reloads its entry configuration.

On Windows, Dev and Preview prepare an AIY-branded runtime under `.tmp/development-electron/aiy-development-<fingerprint>/electron.exe`. Keep the executable named `electron.exe`: Electron uses that basename to determine `app.isPackaged`, so renaming it makes source runs look for installed resources instead of the checkout's icons, extensions, and Preview snapshot. The fingerprint changes with the icon and runtime; only the executable is copied and edited, while unchanged runtime files use hard links (with a copy fallback) and resource directories use junctions. The npm-managed executable remains unchanged. `ELECTRON_EXEC_PATH` bypasses this preparation.

### Preview production builds

`npm run preview` verifies the Electron installation directly in its prehook, then builds and launches the production app. The prehook avoids nesting another npm invocation. Subsequent runs reuse unchanged main, preload, and renderer bundles. Changes to a target's sources rebuild that target; shared sources, build scripts, configuration, extensions, environment variables, and dependency installation metadata invalidate all targets. Missing or modified output files also trigger a rebuild, including output replaced by `npm run dev` or `npm run build`.

Targets that need rebuilding share one configuration load and process, with at most two builds active at once (one on a single-CPU host). Rolldown performs compilation in native threads. The renderer starts first so main and preload compilation can finish alongside it. Each target writes its own output directory and uses the existing production build configuration and checks. A failure stops new work and waits for active builds before returning; Electron starts only after all required builds succeed. Preview logs target timings instead of the full bundle listing; warnings and errors remain visible.

The build tool is pinned to `vite: npm:rolldown-vite@7.3.1`, the [official Vite 7 integration](https://v7.vite.dev/guide/rolldown) of the native Rolldown bundler, with Oxc minification. This also accelerates full `npm run build` runs. The `aiy-electron-rolldown-options` plugin applies electron-vite 5's preset changes to the native options field before validation; keep it on main, preload (including isolated entries), and renderer. Dependency boundaries, standalone preload requirements, and renderer chunk budgets remain enforced. Reinstall dependencies after updating this checkout. The Vite 7 integration is an experimental migration package, so its version is pinned; moving to Vite 8 requires checking electron-vite compatibility separately.

Main also keeps VFile's small Node adapter modules intact with `aiy-vfile-node-interop`. Rolldown beta.53 otherwise drops their CommonJS default-import conversion during tree shaking, causing Markdown parsing to access an undefined `process.default`. Keep this compatibility plugin until a bundler upgrade is verified by executing Markdown parsing in the built main bundle.

Preload also applies `aiy-preload-document-detection` to ProseMirror's browser feature detection. Shared content schemas currently import the Tiptap serializer, so this code can run before Electron creates `document.documentElement`. The adapter guards that one style lookup, preserves source maps, and fails the build if the dependency's expected expression changes. It does not delay bridge installation or modify renderer editor behavior.

```bash
npm run preview -- --build-only
npm run preview -- --force
```

`--build-only` prepares the same bundles without launching Electron. `--force` rebuilds every target; use it after manually editing installed dependencies. Cache metadata lives in `.tmp/preview-build/` and uses file size, modification time, and change time without reading every source or generated bundle. After building, the default Preview path starts the installed Electron executable directly, avoiding another Node process and electron-vite import just to launch the app. Other electron-vite options, such as `--mode` or `--config`, use the original CLI without cache reuse. `npm run build` always performs a full production build, including the runtime dependency, preload isolation, and renderer chunk checks.

Before launching, default Preview asynchronously copies the renderer output into a session directory under `.tmp/preview-build/` and verifies that the source output has not changed during the copy. The renderer protocol serves that snapshot for the lifetime of the Electron child process, so rebuilding `out/renderer` cannot remove JavaScript or CSS chunks that an already-open window has yet to load. The snapshot is removed after Electron exits or fails to launch. `--build-only` does not create a snapshot; packaged applications use their bundled renderer resources. A window opened before this protection was added needs a full application restart if its original chunks have already been replaced.

Bundle readiness excludes application startup. The `[local-space] context ready` log reports separate database-open, database-initialization, service-connection, extension-loading, and settings timings. Its `databaseCheck` records the reason, check mode, and separate database and foreign-key scan timings. A clean, unchanged database skips those scans. Ordinary unclean app shutdowns use SQLite's [quick_check](https://sqlite.org/pragma.html#pragma_quick_check) plus the full foreign-key check after SQLite performs its own [WAL recovery](https://sqlite.org/wal.html). Quick checks still inspect database structure and table constraints, but omit UNIQUE and index/table consistency verification. Newly created, migrated, or unverified databases retain full integrity and foreign-key checks. An interrupted or failed full check remains marked for a full retry on the next open; it cannot fall back to a quick check.

Recovery checks for an existing file run in a short-lived read-only connection, with one read transaction covering both scans. In-memory databases and initialization inside a transaction use the original connection so uncommitted changes remain visible. Full migration checks always use the original connection. During either scan, SQLite may [map up to 1 GiB of the database](https://sqlite.org/mmap.html) to reuse the OS page cache; this is an address-space limit, not an eager file read or allocation. The previous mapping setting is restored and temporary connections are closed on success and failure, including on Windows where mapped files cannot be truncated. Journal mode, write synchronization, foreign-key enforcement, and interrupted-job recovery are unchanged.

Desktop petals bind to the current library during startup, but their saved windows restore sequentially after the main window is ready and its first bootstrap response has completed (or the existing five-second startup fallback has elapsed). The main window no longer waits for every petal renderer to load. Deferred restoration stops if the context changes or is draining; shutdown waits for the one in-flight renderer before requesting editor saves. Normal in-process library switching still awaits restoration. The `[startup] main window ready` log includes module load, Electron readiness, host setup, library initialization, context activation, and IPC registration timings. For default Preview launches, `previewToWindowMs` also includes compilation and launch time from the Preview script's entry; npm's preceding installation hook is outside that interval.

Use the application's Quit command to complete editor saves and database cleanup before stopping Preview. Repeated quit requests wait for the same cleanup, and a failed service cleanup does not interrupt the remaining services. A terminal or process termination can bypass this path and require a recovery scan on the next launch.

The packaged renderer protocol streams files through asynchronous Node file handles with explicit MIME types for CSS, JavaScript, fonts, and images. Asset loading does not depend on platform MIME inference or a nested Chromium `net.fetch` request. Streams use bounded byte queues and close on cancellation; HEAD responses return metadata without reading file bodies. CSP, path validation, and `nosniff` remain enabled.

### Browser companion during development

`npm run dev` starts Electron and its main-process browser-companion loopback service. It does not start the WXT development server, so browser companion extension issues do not block debugging the desktop app.

To develop the browser companion, start it separately from the umbrella workspace root in a second terminal:

```powershell
npm run dev:browser
```

This command starts the browser companion WXT server on `127.0.0.1:3017`. The unpacked development output remains at `../browser-companion/.output/chrome-mv3-dev`, so a development Profile can keep one stable extension path while WXT handles subsequent source updates. Start `npm run dev` separately when the desktop app and its `127.0.0.1:47831` companion service are also needed. Production builds use the separate `../browser-companion/.output/chrome-mv3` directory and cannot replace a running development bundle.

Load `chrome-mv3-dev` as an unpacked extension once in every intended Chrome or Edge Profile. If a Profile previously loaded `chrome-mv3`, remove that old unpacked entry once and load the new development directory; reloading the old entry cannot change its registered filesystem path. In AIY, configure the browser Profile for ChatGPT, Weibo, and WeChat Official Account independently from the menu beside “上传”; development mode accepts a Profile only when the browser's persisted extension path matches the current checkout. The Chrome `How` Profile used by the automated smoke is `Profile 1` and follows this same rule.

Chrome does not allow a running extension to replace itself with a different unpacked bundle. Start `npm run dev:browser` before opening the development Profile. If the Profile is already running an older production bundle in another Chrome process, close that old Profile session once and let the next AIY handoff reopen it after WXT is ready. Edits made during that development session use WXT HMR and do not require a manual extension reload.

### External deep links during development

Ordinary `npm run dev` does not change the operating-system handler for `aiy://`. To register the current Windows checkout for the lifetime of one development session, use:

```powershell
npm run dev:deep-link
```

While that process is running, an external link such as `aiy://open/gallery` is routed to the development app. A normal exit removes the development registration. If the launcher is terminated before cleanup, remove the remaining registration explicitly:

```powershell
npm run deep-link:unregister
```

For a registration that must outlive one development session, manage it explicitly:

```powershell
npm run deep-link:register
npm run dev
npm run deep-link:unregister
```

Development registration temporarily takes ownership of `aiy://` from any installed build. `aiy-media://` remains an application-internal media protocol and is never registered as an external handler. See [External deep links](deep-links.md) for the supported route and integration examples.

On Linux, the npm-installed Chromium setuid helper cannot be owned by root, and
Ubuntu 24.04 restricts its unprivileged-user-namespace fallback. The source-only
development launcher therefore passes Electron's `--no-sandbox` option on Linux.
Only run a checkout you trust. Packaged renderer processes retain the sandbox
configured by the application.

Packaged installations do not require Node.js.

## Runtime data

The first launch creates an empty, user-owned library. The default data locations are:

```text
Microsoft Store: <Store app data>/AIY-Store/libraries/
Windows source development: %APPDATA%/AIY/libraries/
Linux source evaluation: ~/.config/AIY/libraries/

libraries/
├─ index.json
└─ <library-id>/
   ├─ library.json
   ├─ library.sqlite3
   ├─ objects/sha256/
   └─ temp/generation/
```

Set `AIY_USER_DATA_DIR` to choose a different user-data root. Extensions and test data use their own managed subdirectories under that root.

`0.3.0` is the first public data baseline. The app does not automatically adopt, migrate, or repair development libraries, fixtures, content-pack source directories, or pre-release databases. If a registered library is missing its database file, the app fails closed instead of silently creating a replacement database.

For backup and recovery boundaries, see [Local spaces, backup, and recovery](tutorials/05-local-spaces-backup-and-recovery.md).

## Development commands

| Purpose                              | Command                        |
| ------------------------------------ | ------------------------------ |
| Start the development app            | `npm run dev`                  |
| Start with temporary deep-link owner | `npm run dev:deep-link`        |
| Persist dev deep-link registration   | `npm run deep-link:register`   |
| Remove dev deep-link registration    | `npm run deep-link:unregister` |
| Check touched files                  | `npm run verify:touched`       |
| Type-check                           | `npm run typecheck`            |
| Check formatting                     | `npm run format:check`         |
| Lint                                 | `npm run lint`                 |
| Public startup smoke                 | `npm test`                     |
| Check public test boundary           | `npm run verify:test-boundary` |
| Production build                     | `npm run build`                |
| Full verification                    | `npm run verify`               |

The public repository keeps only a generic startup-storage smoke check. `npm run verify` runs formatting, lint, type-checking, the public test-boundary check, that smoke check, and a production build. Traditional coverage percentages are reference data and are not part of public verification.

`npm run verify:touched` is the fast feedback lane for an active worktree. It checks format-capable and lintable files reported by Git as staged, unstaged, or untracked, without scanning the whole repository or modifying the checked files. To include committed changes relative to a branch or ref, run `npm run verify:touched -- --base <git-ref>`. This command does not replace type-checking, builds, or the full release gate.

Normal development does not require packaging or updating `release/`.

## Packaging

Run packaging from a clean Windows x64 checkout after a fresh `npm ci`. Do not reuse `node_modules/`, `out/`, or `release/` from another checkout or machine.

The ordinary package commands run the Store gate, build the production bundles, and create an unsigned MSIX for Partner Center:

```powershell
npm run package
# npm run make is an exact alias
```

For packaging-only iteration after the relevant checks have already passed:

```powershell
npm run make:store
```

For a locally signed sideload package:

```powershell
npm run make:store:local
```

Submission output is written to `release/store-msix-<app-version>/submission/`; the local package and its temporary certificate are written under `release/store-msix-<app-version>/local-test/`. Only the unsigned submission MSIX goes to Partner Center. The generated local-test PFX must never be uploaded or committed.

The script validates the Store identity, x64 architecture, semantic-to-Store version mapping, bundled content boundary, update-helper protocol, signature mode, and SHA-256 metadata before retaining the artifact. The Electron unpacked directory is deleted after it is folded into the MSIX and is not a deliverable.

## Extensions and tutorials

- [User tutorials](tutorials/README.md) — installation, first launch, first generation, material import, dictionary workflows, and local spaces.
- [Extension development](extensions/README.md) — manifests, language packs, capability extensions, and templates.
- [Git workflow](git-workflow.md) — branch and release conventions.
- [Release notes](release/) — version differences, packaging inputs, and release validation.

## License and security

The project is licensed under the [PolyForm Noncommercial License 1.0.0](../LICENSE). For security issues, read [SECURITY.md](../SECURITY.md); do not include credentials, personal data, or vulnerability details in a public issue.
