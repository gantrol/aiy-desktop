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

### Browser companion during development

`npm run dev` starts Electron only. It does not build the browser companion Native Host or start the WXT development server, so browser companion issues do not block debugging the desktop app.

To develop the browser companion, start it separately from the umbrella workspace root in a second terminal:

```powershell
npm run dev:browser
```

This command prepares the SEA Native Host and starts the browser companion WXT server on `127.0.0.1:3017`. The unpacked development output remains at `../browser-companion/.output/chrome-mv3-dev`, so a development Profile can keep one stable extension path while WXT handles subsequent source updates. Start `npm run dev` separately when the desktop app is also needed. Production builds use the separate `../browser-companion/.output/chrome-mv3` directory and cannot replace a running development bundle.

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
