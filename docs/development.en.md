# Development

[![简体中文](assets/zh-cn.svg)](development.md) [![English](assets/en.svg)](development.en.md)

Run these commands from the desktop application root containing [package.json](../package.json). In the full workspace, first enter `apps/desktop/`.

## Requirements

| Environment   | Requirements                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| All platforms | Git, Node.js 24 or 22.13+ within 22.x, npm; follow the locked toolchain's engines requirements                             |
| Windows       | Development runs directly; Store packaging also needs the [Windows build tools](packaging.en.md#windows-build-environment) |
| macOS         | Xcode Command Line Tools, including Swift for the native petal input helper                                                |
| Linux         | Source execution and validation; current packaging commands do not produce Linux installers                                |

Dependency versions are defined by `package.json` and `package-lock.json`. The browser companion maintains separate dependencies in `browser-companion/`.

## First-time setup

Check the working directory, then install the locked dependencies:

```sh
node --version
npm --version
npm ci --no-audit --no-fund
```

After installation succeeds, start development:

```sh
npm run dev
```

The `dev` prehook prepares Electron and, on macOS, the native helper. Renderer changes use hot updates; main-process and preload changes restart Electron.

## Existing environments

Run `npm run dev` directly for everyday development. Changes to application source, text, documentation or the application version alone do not require reinstalling dependencies.

| Change                                                                         | Action                                                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Dependencies and runtime environment in the same checkout are unchanged        | Reuse `node_modules/`                                                   |
| Only the lockfile's top-level and root-package application versions changed    | Review the diff and reuse the installation                              |
| Dependency declarations, resolved dependencies or installation options changed | Review the diff and prepare the affected dependencies from the lockfile |
| Node/Electron native ABI, platform or architecture changed                     | Check and rebuild or reinstall affected native dependencies             |
| Dependencies are missing, damaged or left by an interrupted installation       | Diagnose first; use `npm ci` when a complete restoration is needed      |

`npm ls --depth=0` helps identify missing or invalid direct dependencies. It does not replace lockfile comparison or verify package-file integrity. Do not copy dependency directories between machines or checkouts.

`npm ci` removes the existing `node_modules/` before installation. Check whether Dev, Preview or another process is using that directory; save and quit the relevant session normally before proceeding. Investigate file ownership after `EPERM`, and confirm dependency completeness after a failed installation. Retain the npm download cache instead of repeatedly clearing directories and retrying. [npm ci reference](https://docs.npmjs.com/cli/v11/commands/npm-ci/)

## Builds and previews

| Command                                   | Purpose                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`                             | Development mode with hot updates                                             |
| `npm run build`                           | Full production build into `out/`, without launching the app                  |
| `npm run preview`                         | Prepare production output and launch the app, reusing unchanged build targets |
| `npm run preview -- --build-only`         | Prepare output using Preview's cache rules, without launching the app         |
| `npm run preview -- --force --build-only` | Force fresh Preview output without launching the app                          |
| `npm run design:dev`                      | Start the component design workbench                                          |

Restart the development process after changing `electron.vite.config.ts`. Use the application's Quit command to finish editor saves and database cleanup before ending a development or preview session.

## Browser companion

Run the desktop and browser companion separately. Open another terminal at the desktop application root. Install the companion's dependencies on first use:

```sh
npm run install:browser
```

For subsequent development sessions, start it directly:

```sh
npm run dev:browser
```

WXT prefers `127.0.0.1:3017`; use the address printed in the terminal if that port is unavailable. Start the desktop separately with `npm run dev`.

Once built, the development extension uses local scripts and popup resources. `dev:browser` provides rebuilds and hot reload; the installed development extension can still upload and show handoff status when that server stops or its hot reload connection fails. The desktop handoff service must remain running, and the target website must be reachable. To adopt this change for the first time, rebuild and reload the existing development extension in the browser.

Desktop requests run in the companion background using the extension's loopback host permission, independently of the target website's local network permission. The relay accepts only fixed handoff endpoints, checks the sender and target, and transfers images in acknowledged chunks while preserving signature and integrity checks. This transport change also requires an updated desktop build; reloading the extension alone does not update the desktop endpoint.

| Purpose                                     | Path or command                             |
| ------------------------------------------- | ------------------------------------------- |
| Development extension loaded by the browser | `browser-companion/.output/chrome-mv3-dev/` |
| Production extension output                 | `browser-companion/.output/chrome-mv3/`     |
| Type checking                               | `npm run typecheck:browser`                 |
| Production build                            | `npm run build:browser`                     |

Development Profiles should load the development directory. Production output cannot replace a running development extension. The companion is a separate artifact and is not included in the desktop MSIX.

## Code checks

Choose checks for the change being made; use complete verification for a release:

| Command                                  | Checks                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run verify:touched`                 | Formatting and lint for staged, unstaged and untracked files                                   |
| `npm run verify:touched -- --base <ref>` | Also include committed changes relative to a Git reference                                     |
| `npm run typecheck`                      | TypeScript types                                                                               |
| `npm run test:smoke`                     | Generic startup and storage smoke                                                              |
| `npm run verify`                         | Pricing-catalog structure, formatting, lint, types, smoke boundary, smoke and production build |

For documentation changes, check content, commands, links and diffs. For behavior changes, run the appropriate unit, component or integration checks according to risk; the generic smoke does not establish complete feature acceptance. A successful build does not establish installation, platform handoff or publication success.

## Source and resource layout

| Directory                       | Responsibility                                               |
| ------------------------------- | ------------------------------------------------------------ |
| `src/main/`                     | Electron main process, storage, tasks and system integration |
| `src/preload/`                  | Restricted bridge between renderer and main process          |
| `src/renderer/`                 | React UI, components, styles and language resources          |
| `src/shared/`                   | Cross-process contracts, validation and shared rules         |
| `extensions/`, `content-packs/` | Bundled extensions and content packs                         |
| `browser-companion/`            | Browser extension                                            |
| `scripts/`, `native/`           | Build tools and native helpers                               |

Read UI text through `useI18n().messages`. Maintain English in `src/renderer/i18n/locales/en.ts` and Chinese in `extensions/com.aiy.language.zh-cn/messages.json` together. Reuse existing shadcn components and Tailwind utilities, and use asynchronous file I/O.

## Logs and troubleshooting

- Development log: `dev-logs/desktop-dev-current.log`.
- Preview log: `dev-logs/desktop-preview-current.log`.
- Renderer diagnostics: `diagnostics/renderer/renderer-current.jsonl` under the application user-data directory.
- Native crash dumps: `crashes/` inside the same diagnostics directory. Crashpad initializes during startup and stores dumps locally without automatic uploads. Dumps may contain process memory and must not be published as ordinary redacted logs.

The `crash-reporter-ready` diagnostic records the application, Electron and Chromium versions and platform. `crash-reporter-failed` indicates that dump initialization failed; the application still starts. Windows exit code `-36861` (`0xffff7003`) means the process was not connected to a Crashpad handler. It does not identify the original crash cause; inspect the native dump alongside preceding operations and memory records.

Set `AIY_USER_DATA_DIR` to use a separate application data directory. Investigate migrations, imports and recovery using a copy of the data, rather than modifying the only user database. Include the source commit, execution command and redacted logs in problem reports.

[Documentation](index.en.md) · [Packaging](packaging.en.md) · [Releases](release.en.md)
