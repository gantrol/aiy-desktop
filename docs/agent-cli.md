# AIY agent CLI

`aiy-agent` is the first local integration boundary for coding agents. It connects to the current AIY library's authenticated background worker; it does not open SQLite, access the renderer, or bypass AIY's generation services.

Offline `handoff prepare` and `handoff verify` compile and check explicitly supplied development context without opening a library or contacting a worker. See [Development handoffs](development-handoffs.md) for usage, limits and the distinction between consistency, evidence and permission.

The first worker contract version exposes:

- `capabilities`
- `content read`
- `asset import`
- `intake import`
- `intake get`
- `pack preview`
- `pack apply`
- `draft prepare`
- `generation start`
- `job get`
- `job cancel`
- `action send-weibo`

Build the desktop project, then run either the linked `aiy-agent` executable or the built repository entry:

```text
npm run build
node out/main/agent-cli.js capabilities
```

For worker commands, AIY Desktop must be open, or its detached background worker must still be alive. The CLI reads the current library registry and worker descriptor, verifies both the wire version and the matching bundled worker fingerprint, authenticates over the existing local socket, and exits after one command. A running older build is rejected before advertising capabilities or sending newer commands; save your work and restart AIY with the matching build.

## JSON and retries

For standalone Markdown articles/outlines and PNG materials, see [Collect local outputs](agent-intake.md). Grouped creations use [Content packs](content-packs.md); both the CLI and the UI call the same preview and installation service.

For reading existing AIY articles, outlines and saved materials, use [Copy a link for an Agent](agent-content.md). The copied instructions include the local CLI path, data root and JSON request; no Skill is required.

Every operational request contains `protocolVersion: 1`. Generation and standalone-intake mutations also contain an opaque `requestId`. AIY binds that ID to the command and normalized input hash. An exact retry returns the stored result; reuse with different input fails with `AIY_AGENT_REQUEST_CONFLICT`.

`pack apply` instead uses the existing content pack identity, immutable release and the two hashes returned by `pack preview`. An exact repeat converges on the same installation; it does not use a parallel intake receipt.

Standard output contains one JSON envelope. Diagnostics use standard error. Generation start returns a persistent `jobId` without waiting for provider completion.

## Command actions

`action send-weibo` accepts a completed generation `jobId` and the intended post text. AIY resolves only that
job's immutable generated outputs, copies them into the existing browser-companion handoff store, and opens the
Weibo composer through the browser Profile configured for Weibo. It does not accept arbitrary image paths and does not use
desktop automation. The user remains responsible for reviewing the filled draft and clicking Weibo's final publish
control.

The explicit command is the operation grant for that immutable job output. It does not grant reusable library,
filesystem, cookie, or publication access to the browser adapter; the adapter receives only the one selected
handoff. The action is advertised and accepted only when the packaged `com.aiy.channel.weibo` manifest is present
and matches its fixed host-runtime contract.

```json
{
  "protocolVersion": 1,
  "requestId": "6f363710-4895-4d06-aa50-66a92e55a8a2",
  "jobId": "RETURNED_JOB_ID",
  "text": "今天的测试贴图：挥手的橘猫 👋🐱"
}
```

The action uses the same exact-retry rule as other mutating commands. A successful result contains the handoff ID,
whether the browser opened, and a stable browser-open error when staging succeeded but the companion could not launch.
Use a new `requestId` after changing the job or text.

## Image inputs

Only `asset import` accepts a filesystem path. The path must be explicit, absolute, and identify one ordinary PNG, JPEG, or WebP file no larger than 25 MB and 4096 × 4096. AIY rejects symlinks, wildcards, directories, URLs, invalid signatures, malformed or truncated containers, and unsafe dimensions, then copies the verified bytes into its content-addressed object store. PNG imports additionally undergo complete chunk, CRC, inflate, and raster-length validation; JPEG and WebP use structural container validation in this first version.

`draft prepare` accepts only stable AIY `assetId` values. Each reference has an explicit role and array position; AIY freezes both into the generation prompt. A chat attachment that Codex can see is not a local path and cannot cross this boundary until the user supplies a path or imports it in AIY.

The repository Skill at `.agents/skills/aiy-cli/` contains the agent-facing workflow and complete request examples.
