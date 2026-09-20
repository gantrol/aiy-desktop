# Offline development handoffs

The existing `aiy-agent` entry now accepts two offline commands. They compile explicitly supplied text snapshots into a handoff packet, and check that a returned packet is internally consistent. They do not connect to the background worker, read the library or repository, run a model, fetch a URL, or execute suggested commands.

This is a first integration slice, not a requirement database, GitHub connector, approval system or persistent task runner. The editable software-development outline remains a separate way to prepare the source notes.

## Prepare and inspect

After building the app, copy and edit [the example request](examples/development-handoff.json). Supply only material intended for the recipient, and check it for private information before sharing.

```sh
node out/main/agent-cli.js handoff prepare --input docs/examples/development-handoff.json > handoff-result.json
node -e "const f=require('node:fs'),r=JSON.parse(f.readFileSync('handoff-result.json','utf8'));if(!r.ok)throw Error(r.error.code);f.writeFileSync('handoff.json',JSON.stringify(r.data));f.writeFileSync('handoff.md',r.data.brief)"
node out/main/agent-cli.js handoff verify --input handoff.json
```

`--input -` reads one request from stdin. `verify` expects the packet in `data`, not the outer CLI response envelope. `--user-data-dir` is rejected for these commands: choosing a library is neither required nor an implied data-access grant. Existing operational commands and `capabilities` still require their authenticated worker connection. `--help` lists the offline commands without one.

The packet contains a readable brief, normalized input, SHA-256 of each supplied source text, and a digest covering the normalized input and source digests. The brief is also checked against the deterministic renderer. Whitespace inside source text and array order are significant; JSON object key order is not. Optional arrays default to empty arrays before hashing. Identical normalized input produces the same result. There is no timestamp, network lookup, job reservation or paid execution.

## Input and meaning

Required fields are `protocolVersion: 1`, a `taskId`, a `phase`, and an `objective`. Supported phases are `expression`, `trial`, `confirmation`, `development`, `acceptance`, and `maintenance`. Phase describes the supplied context; selecting `confirmation` does not make the requirement approved, and selecting `acceptance` does not run a check.

Optional `repository` contains an HTTPS URL without credentials, query or fragment, and a full lowercase 40- or 64-character hexadecimal `baseCommit`. These are caller-supplied identifiers, not a checkout or independently verified repository state. A branch name is not accepted as a frozen commit.

`constraints`, `outOfScope`, and `questions` contain text. `sources` contain a stable local ID, title, exact selected text, and a kind: `requirement`, `observation`, `research`, `decision`, or `verification`. Optional locator and revision strings preserve context without fetching anything. Source status is `unreviewed`, `selected`, or `superseded`; it defaults to `unreviewed`. Superseded decisions may be useful negative context and are not silently removed. Selected does not mean independently verified or approved.

Acceptance entries contain an ID, an observable expectation and optional source IDs. IDs must be unique within their respective lists, referenced sources must exist, and duplicate references are rejected. The brief always marks current acceptance criteria as **NOT RUN**. A supplied historical verification record does not convert them into a current pass.

The recipient is asked to return the task ID and handoff digest, actual code baseline and result revision, evidence for each check, unchecked conditions and remaining questions. Results based on an older baseline remain candidates. This compiler does not receive results, alter a document, accept a change, merge a PR or publish software.

## Integrity is not authentication

`verify` recomputes the normalized input, text digests and brief. Success means internal consistency only. Someone who can edit the entire packet can also recompute its digests. The packet is not signed, does not prove who supplied the evidence, and does not establish source truth, current repository state, authorization or successful tests. Compare its digest to one retained through a trusted channel when handing it to another tool.

The program does not collect credentials or expand input files. It also cannot reliably identify every secret in text supplied by the caller. Review the brief before sending it. Fencing source text preserves the section structure; it is not a prompt-injection sandbox. Permissions must still be enforced by the recipient's host.

## Bounds and errors

The existing CLI accepts at most 1 MiB per JSON request. The compiler additionally allows at most 256 KiB of normalized input and rejects packets exceeding 1 MiB; limits count UTF-8 bytes, not displayed characters. It never truncates sources. Individual fields and counts have smaller schema limits: 24 sources, 30 acceptance entries, 30 items per constraint/question list, and 100,000 characters per source text.

Schema errors return `AIY_AGENT_INVALID_INPUT` without echoing submitted source text. Duplicate IDs and unresolved source links return `AIY_AGENT_HANDOFF_INVALID_*`; size failures return `AIY_AGENT_HANDOFF_LIMIT`. A mismatch in packet input, text digests or readable brief returns `AIY_AGENT_HANDOFF_CONTENT_CONFLICT`. They use the existing CLI envelope and exit-code conventions: invalid/limit is 2, consistency conflict is 4. The compiler itself creates no output files. It writes a response to stdout; callers own redirection and must check `ok` before treating the file as a prepared packet.

## Integration boundaries

The schema lives in `src/shared/contracts/development-handoff.ts`. Preparation and verification live in `src/main/agent-cli/development-handoff.ts`; `handoff-command.ts` validates the boundary. The existing CLI dispatches these commands before workspace discovery. No worker protocol, database schema, credentials, dependencies or application version changes are needed.

Run the repository's standard format, lint, type, smoke, boundary and build checks. Detailed development regressions belong in the private test harness, not the public smoke tree. Useful cases include malformed URLs, duplicate/missing evidence IDs, misleading source instructions, stale/modified packets, preserved Unicode and source order, exact-repeat output, oversized text, no implied approval, and running with no active AIY library.
