# Electron end-to-end tests

Playwright drives the built Electron app over the DevTools protocol. It does not
use Windows UI Automation or OS-level mouse and keyboard injection, so the suite
does not take over the active desktop.

```bash
npm run build
npm run test:e2e -- --workers=1
```

The build is required because this lane launches `out/main/index.js`. Use a
targeted file while iterating, for example:

```bash
npx playwright test e2e/reference-lifecycle.e2e.ts --workers=1
```

## Current coverage

| Area        | Journeys                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell       | Cold start, primary navigation, clean main/renderer/network diagnostics, zero provider traffic                                                                                                                            |
| Creation    | New prompt, term insertion, V01 save, browse/reopen, rename/delete, local replay generation, crop persistence, and a progressively rendered 320-series history                                                            |
| Reference   | Create, edit, save, approve, search/reopen, archive/restore, maintenance refresh, and a 5,000-row import                                                                                                                  |
| Materials   | Drag/drop review and import; browse/search; inspector editing; favorite/rating/metadata persistence; album create/add/rename/remove/delete; a maximum 200-material batch; 48 MB, 24 MP, and 2,000-item performance shapes |
| Interaction | Existing material remains openable and editable during a deliberately delayed import; every important action has a progress/result/error probe                                                                            |
| Performance | Real launch timing, delayed-worker recovery UI, per-action feedback, progressive DOM bounds, renderer long tasks, and renderer/main event-loop delay                                                                      |

The repository-wide synchronous I/O and batch-query classification, fixed call
chains, measured regression values, and retained bounds are in the v0.3 report:
[`21-desktop-e2e-performance-io-audit.md`](../../../tools/docs/v0.3/21-desktop-e2e-performance-io-audit.md).

## Two-second interaction contract

`support/responsiveness.ts` enforces the foreground budget for important user
actions:

1. The Playwright action itself must settle in less than 2 seconds.
2. Within the same 2-second window the UI must expose progress, a result, or an
   explicit error/feedback state.
3. Each journey records renderer long tasks plus renderer and Electron
   main-process event-loop delays. A foreground stall of 2 seconds fails the
   test.

Use an existing `aria-busy`, operation-state, or result locator as the response
probe. If work can take longer, keep it off the renderer/main-process foreground
path and show a visible pending state. Do not add fixed sleeps.

`material-import-performance.e2e.ts` separates four costs: drag feedback,
preview decode, commit feedback, and imported-card availability. Its padded PNG
fixtures stress file transfer, hashing, and object-store I/O without conflating
those with decode; the 24 MP fixture separately stresses decoded pixel volume.
Fixture preparation and large-library seeding are reported but excluded from the
interaction budget.

The material-album batch test uses the IPC maximum of 200 selected materials.
The creation volume test verifies both complete oldest/newest data and a bounded
initial render, so a fast bootstrap cannot hide a renderer that creates hundreds
of rows at once.

The 2,000-material, 5,000-term, 320-series, and 200-member journeys are
hardware-intensive milestone gates. After one passes, do not repeatedly rerun it
while iterating on an unrelated path. Use the smallest affected journey and the
fast type/lint/integration lanes; rerun a volume gate only when its call chain
changes or as part of an agreed release/CI verification.

Startup uses deliberately loose smoke ceilings (`15s` to first window and `20s`
to the first interactive view) because absolute CI timing varies. The attached
`startup-profile.json` is intended for median/trend comparison on consistent
hardware. A separate deterministic journey delays the worker handshake by three
seconds: the foreground must still appear with a visible `RECONNECTING` state in
under two seconds, remain responsive, and transition to `CONNECTED` without a
native error dialog.

## Isolation and network policy

Every test gets:

- a fresh, short `AIY_USER_DATA_DIR` under the system temporary directory;
- a loopback OpenAI-compatible stub;
- empty paid-provider API keys;
- a deterministic in-process replacement for model-backed title suggestions;
- the built-in local replay model for deterministic generation;
- native file dialogs stubbed in the Electron main process;
- bounded app and detached-worker shutdown.

The short temporary path is intentional. Long Playwright output paths can push
content-addressed media beyond Windows' legacy 260-character path boundary,
which Chromium reports as a misleading missing-file error.

Tests seed only the records required by a journey through the typed preload IPC
surface. They never touch the developer's real library and never call a paid
API. Main-process errors, renderer errors, and failed resource URLs are attached
to failures.

## Stable selectors

`support/selectors.ts` is the source of `data-view` and `data-action` names.
Domain records use stable IDs such as `data-term-id` and `data-series-id`.
Prefer those contracts and role/label locators over CSS structure or translated
copy.

`tests/e2e-selector-contract.architecture.test.ts` catches selector drift in the
fast architecture lane. The known stale capture actions are a shrink-only list;
new missing actions fail immediately.

When adding a journey:

- cover a user outcome, not a sequence of implementation details;
- seed deterministic local data rather than depending on execution order;
- assert the persisted result after navigating away and reopening it;
- give every important action a progress/result/error probe;
- assert that the provider stub saw only the requests the journey intended;
- keep traces, screenshots, timing profiles, and diagnostics as failure evidence.

## Research basis

The lane follows Playwright's guidance on
[test isolation](https://playwright.dev/docs/browser-contexts),
[resilient locators](https://playwright.dev/docs/locators), and
[web-first assertions](https://playwright.dev/docs/test-assertions), plus
Electron's [process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
and [performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance).
