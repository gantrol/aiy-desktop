# AIY agent CLI contract

The executable is `aiy-agent`. In this repository, `node out/main/agent-cli.js <command>` invokes the same built entry without npm argument rewriting.

All operational commands take `--input REQUEST.json`; use `--input -` for one JSON object on stdin. `--user-data-dir PATH` selects an explicit AIY data root when normal and Store roots both exist.

Commands:

```text
aiy-agent capabilities
aiy-agent asset import --input REQUEST.json
aiy-agent draft prepare --input REQUEST.json
aiy-agent generation start --input REQUEST.json
aiy-agent job get --input REQUEST.json
aiy-agent job cancel --input REQUEST.json
aiy-agent action send-weibo --input REQUEST.json
```

`action send-weibo` is available only when `capabilities.commandActions` includes `send-weibo`; AIY publishes it
only after the packaged Weibo channel manifest passes its fixed host-runtime contract.

Generate opaque request IDs locally. UUIDs are suitable.

Asset import:

```json
{
  "protocolVersion": 1,
  "requestId": "7fd7b433-1e42-4c6a-88da-789f874a4a03",
  "path": "D:\\art references\\character, front.png"
}
```

The path must be absolute and identify one ordinary PNG, JPEG, or WebP file. Directories, wildcards, URLs, symlinks, and chat-only attachments are not accepted. AIY validates and copies the image before returning a stable `assetId`.

Draft preparation:

```json
{
  "protocolVersion": 1,
  "requestId": "f331409d-842a-4d86-9a5b-77ff7556ab68",
  "title": "猫咪表情贴图",
  "titleLocale": "zh",
  "prompt": "绘制透明背景的圆润猫咪挥手贴图",
  "modelKey": "LIVE_ROUTE_KEY_FROM_CAPABILITIES",
  "quality": "high",
  "count": 1,
  "canvasPresetKey": null,
  "width": 1024,
  "height": 1024,
  "references": [
    { "assetId": "RETURNED_ASSET_ID", "role": "主体外观" },
    { "assetId": "EXISTING_ASSET_ID", "role": "上色风格" }
  ]
}
```

The model route, supported quality values, and reference-image limit come from `capabilities`. Omit dimensions by setting both `width` and `height` to `null`.

Generation start:

```json
{
  "protocolVersion": 1,
  "requestId": "828e5f64-baa7-48e4-969d-36cd841ab4cb",
  "draftId": "RETURNED_DRAFT_ID"
}
```

Job query:

```json
{ "protocolVersion": 1, "jobId": "RETURNED_JOB_ID" }
```

Successful runs whose output is still available include an immutable AIY `assetId` and an absolute local output path. A prepared job has state `PREPARED`; started jobs use `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, or `INTERRUPTED`.

Cancellation:

```json
{
  "protocolVersion": 1,
  "requestId": "41eb3084-5d55-41f8-af6c-ebbb40520fdb",
  "jobId": "RETURNED_JOB_ID"
}
```

Weibo handoff:

```json
{
  "protocolVersion": 1,
  "requestId": "6f363710-4895-4d06-aa50-66a92e55a8a2",
  "jobId": "RETURNED_JOB_ID",
  "text": "今天的测试贴图：挥手的橘猫 👋🐱"
}
```

The job must be `SUCCEEDED`, and every run must still have an available immutable output. AIY stages those outputs
in its existing browser-companion store and opens `https://weibo.com/` in the browser Profile configured for Weibo. The result
contains `handoff`, `browserOpened`, and `browserOpenError`. This command does not accept arbitrary attachment paths,
does not use desktop control, and never clicks Weibo's final publish control.

Standard output contains exactly one JSON value for normal commands:

```json
{
  "protocolVersion": 1,
  "ok": true,
  "command": "job get",
  "data": {}
}
```

Failures set `ok` to `false` and include a stable `error.code`. Human diagnostics go to standard error.
