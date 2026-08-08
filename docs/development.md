# Desktop development

This document covers engineering workflows for `apps/desktop`. For the product overview and external model dependencies, see the [main README](../README.md).

## Requirements

- Windows 10/11 x64 for the Windows build.
- Apple Silicon (arm64) macOS for the `v0.3.1` macOS package.
- Node.js 22 or newer.

The current build and validation targets are Windows and macOS. Linux is not in the packaging scope of this project.

## Run from source

Run commands from `apps/desktop`:

```powershell
cd apps/desktop
npm ci
npm run dev
```

`npm run dev` installs the Electron version required by the project first. Renderer changes use Vite HMR; main/preload changes rebuild and restart Electron. After changing `electron.vite.config.ts`, stop the dev process completely and start it again so the host reloads its entry configuration.

Packaged installations do not require Node.js.

## Runtime data

The first launch creates an empty, user-owned library. The default data locations are:

```text
Windows: %APPDATA%/AIY/libraries/
macOS:   ~/Library/Application Support/AIY/libraries/

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

| Purpose                   | Command                                      |
| ------------------------- | -------------------------------------------- |
| Start the development app | `npm run dev`                                |
| Type-check                | `npm run typecheck`                          |
| Check formatting          | `npm run format:check`                       |
| Lint                      | `npm run lint`                               |
| Default Vitest unit tests | `npm test`                                   |
| All Vitest projects       | `npm run test:all`                           |
| Coverage gate             | `npm run test:coverage`                      |
| Electron E2E              | Run `npm run build`, then `npm run test:e2e` |
| Full verification         | `npm run verify`                             |

The default `npm test` command runs the unit lane. Use the focused lane commands while iterating, and use `npm run verify` when a change needs the complete format, lint, type-check, and coverage gate.

See [`tests/README.md`](../tests/README.md) for test lanes, network isolation, and provider stubs. See [`e2e/README.md`](../e2e/README.md) for the Playwright setup, stable selectors, and performance contracts.

Normal development does not require packaging or updating `release/`.

## Packaging

Run a fresh `npm ci` on the target operating system before packaging. Do not reuse `node_modules/`, `out/`, or `release/` produced on another operating system.

Windows validation and packaging:

```powershell
npm run verify
npm run package  # build an unpacked application directory
npm run make     # build Windows installers
```

Apple Silicon macOS validation and packaging:

```bash
npm run verify
npm run make:mac
```

`make:mac` builds the native architecture of the current Mac and produces a DMG and ZIP. Apple Developer signing and notarization credentials are not stored in the repository; configure and validate them separately before distribution.

## Extensions and tutorials

- [User tutorials](tutorials/README.md) — installation, first launch, first generation, material import, dictionary workflows, and local spaces.
- [Extension development](extensions/README.md) — manifests, language packs, capability extensions, and templates.
- [Git workflow](git-workflow.md) — branch and release conventions.
- [Release notes](release/) — version differences, packaging inputs, and release validation.

## License and security

The project is licensed under the [PolyForm Noncommercial License 1.0.0](../LICENSE). For security issues, read [SECURITY.md](../SECURITY.md); do not include credentials, personal data, or vulnerability details in a public issue.
