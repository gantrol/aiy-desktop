# Test lanes

## Cost rule

A test run costs nothing. No lane, no configuration, and no accidental default
may reach a paid provider.

`tests/support/network-guard.ts` is installed by every Vitest lane through
`vitest.shared.ts`. It blocks `fetch`, `node:http`/`https`, and raw socket
connections to anything that is not loopback, and deletes provider credentials
from the environment so a developer machine behaves like CI. Anything that needs
a provider uses a stub — see the layers below. The only code that can spend money
is `scripts/manual-openai-image-acceptance.mjs`, which lives outside every runner
glob and requires two independent confirmations.

## Lanes

| Lane         | Files                    | Environment | Command                     |
| ------------ | ------------------------ | ----------- | --------------------------- |
| Unit         | `*.test.ts`              | node        | `npm run test:unit`         |
| Component    | `*.dom.test.tsx`         | jsdom       | `npm run test:component`    |
| Integration  | `*.integration.test.ts`  | node        | `npm run test:integration`  |
| Architecture | `*.architecture.test.ts` | node        | `npm run test:architecture` |
| End-to-end   | `e2e/*.e2e.ts`           | Electron    | `npm run test:e2e`          |
| Benchmark    | `bench/*.bench.ts`       | node        | `npm run bench`             |

`npm run test:all` runs the node and jsdom lanes as separate Vitest projects in one
process. `npm run test:coverage` runs that same project set with one full-application
coverage denominator (`src/**/*.{ts,tsx}`), so component execution is merged with
unit, architecture, and integration execution instead of being reported against a
hand-picked file list.

The coverage gate is anchored to the release-source baseline measured on
2026-08-07 with Node 22.22.3 and Vitest 4.1.10: 28.4% lines, 26.5% statements,
24.0% functions, and 21.3% branches. The report is still written when a test
fails. `npm run verify` runs type checking followed by this combined test and
coverage gate.

- **Unit** — fast pure-logic checks. Must not open a real SQLite database or
  create temporary filesystem fixtures. Targets a sub-three-second loop.
- **Component** — real DOM, real effects, real events, via Testing Library.
  Anything that depends on refs, layout measurement, pointer gestures, or state
  transitions belongs here. The older SSR-based component checks in `*.test.ts`
  render through `renderToStaticMarkup`, which cannot run an effect or dispatch
  an event; new interaction coverage should not be written that way.
- **Integration** — real SQLite, migrations, filesystem boundaries, complete
  fixture packs, and the loopback protocol stub.
- **Architecture** — source-level structural contracts. Appropriate for import
  boundaries, token layering, and selector contracts. Not appropriate for
  asserting Tailwind class strings: that tests the source text rather than the
  rendered result, and breaks on refactors that change nothing observable.
- **End-to-end** — the built Electron app driven by Playwright over the DevTools
  protocol. No OS-level input injection: the real pointer never moves and
  keyboard focus is never taken. Requires `npm run build` first.
- **Benchmark** — storage microbenchmarks. Not a gate; compare medians across
  runs on one machine.

The per-lane commands remain available for fast feedback, but only the combined
run is a coverage gate. Every project receives the mandatory network guard through
`vitest.shared.ts`.

## Stub layers

Pick the shallowest layer that can answer the question.

| Layer | Tool                                         | Verifies                                                  |
| ----- | -------------------------------------------- | --------------------------------------------------------- |
| L0    | `tests/fixtures/**`                          | prompt compilation, size validation, error classification |
| L1    | `FakeGenerationAdapter`                      | coordinator, persistence, retry, cancellation             |
| L2    | `startOpenAiStub()`                          | multipart order, headers, SSE framing, timeouts           |
| L3    | stub + temp SQLite + worker                  | the full IPC and recovery chain                           |
| L4    | `scripts/manual-openai-image-acceptance.mjs` | account permission against the live service               |

L0–L3 cover functional correctness and cost nothing. L4 is manual, optional, and
never a release or CI prerequisite.

`GenerationAdapter` is already the provider-neutral boundary, so L1 needs no new
interface — `FakeGenerationAdapter` implements it and scripts one step per run.
Reach for L2 only for wire-format questions; a mocked `fetch` cannot answer them,
and a real socket on 127.0.0.1 can.

### Fixtures

`tests/fixtures/` holds hand-authored payloads built from the documented provider
field structure. They are never recorded from a live call: recording one means
paying for it, and a recorded payload drifts silently. Binary fixtures are
generated so every byte is reviewable:

```bash
npm run fixtures:images
```

`.gitignore` ignores `*.png` repository-wide, with an explicit exception for
`tests/fixtures/**` — check that exception still exists before adding image
fixtures anywhere else.

## Combinatorial test design

`tests/support/combinatorial.ts` reads a PICT-style model and produces a pairwise
suite: every value pair of every factor pair appears at least once. The
generation model in `tests/models/generation.pict` has 41,472 raw combinations,
of which 3,000 satisfy its constraints, covered by 45 cases.

Use pairwise for configuration spaces with pass/fail outcomes. Use boundary-value
and property-based testing for value spaces — applying pairwise to a string
parameter is a category error. Use orthogonal arrays when the response is
continuous (milliseconds, megabytes) and the goal is ranking factor effects
rather than detecting defects.

`tests/models/generation.seed` forces high-risk combinations into the suite
regardless of coverage arithmetic. Never let a generator decide whether your most
dangerous case is included.
