# Copy a link for an Agent

Articles, outlines and saved gallery materials offer **Copy link for Agent** beside their copy/export actions. The clipboard contains the `aiy://` content address, localized reading instructions and a structured Node.js invocation. No Skill, MCP installation or browser navigation is required. The Agent needs local command execution and Node.js.

Article and outline editors finish saving before copying. A save conflict or failure stops the operation. Material metadata must be saved before copying. Switching content while a copy request is pending discards the stale result.

The invocation supplies the exact CLI bundle path and `--user-data-dir` of the originating AIY instance. Pass `args` as an argument array and serialize `input` to the process's standard input; do not concatenate these values into a shell command. Packaged applications unpack the CLI, its shared chunks and its matching worker bundle so ordinary Node.js can read them without Electron's ASAR support.

## Read the link

```text
node out/main/agent-cli.js content read --input REQUEST.json --user-data-dir PATH
```

`--input -` reads the same request from standard input:

```json
{
  "protocolVersion": 1,
  "url": "aiy://open/space/SPACE_ID/article/ARTICLE_ID"
}
```

Supported routes are `article` (including outlines) and `material` (saved text, image and video materials). `material` takes a material ID, not an image asset ID. Gallery entries without a saved material identity do not expose this action. Album, block and fixed-revision links are outside this first reading contract; unsupported routes, queries and fragments are rejected.

The CLI connects to the authenticated local worker, checks its protocol and bundled fingerprint, and checks that the link's space is active. It never opens SQLite itself. If the worker is unavailable or the running build differs, open or restart the matching AIY application. A different space is an explicit conflict; the command never switches spaces or searches other libraries.

## Result

Successful results use the normal `ok: true` CLI envelope and contain:

- The canonical `url`, `spaceId`, target type and entity ID.
- `title` and `markdown` from the latest saved content. Unsaved editor state is not read.
- `revisionId` for articles/outlines; materials return `null`.
- `contentHash`, the SHA-256 of expanded Markdown before local image paths are substituted.
- `media`, including validated local `absolutePath`, MIME type, stored object SHA-256, byte size and dimensions.

Article content and fixed reference expansion are selected in one database transaction. References use their captured content, not their source's current version. Only body-referenced images are resolved; unused bindings are omitted. Inline, reference-style and internal AIY image destinations are rewritten to local file URLs. Standalone image/video materials return their selected media file and metadata note; text materials return their text. Media hashes are stored object identities, not a fresh full-file integrity audit.

The response is bounded to 1,000,000 Markdown characters and 100 media files. Limits and unavailable local media fail explicitly rather than returning truncated content. Metadata lookup is batched, file validation uses the existing asynchronous resolver, and cancellation is checked around that work. The command neither downloads remote images nor expands linked documents, attached files, comments or whole albums. Reading does not modify content, create exports, start generation or publish anything.

These links point to the latest saved content. Reusing a copied link later can return a newer article revision; keep the returned `revisionId` when discussing the result. A bare link handed to an Agent without the clipboard instructions does not establish a reading integration.
