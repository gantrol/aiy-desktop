# Collect local outputs with the AIY agent CLI

The initial collection lane saves one standalone Markdown article or one PNG gallery material per explicit request. It uses the authenticated local AIY worker. AIY must already be running with a matching build.

Run `node out/main/agent-cli.js capabilities` and require the returned `data.intake` capability before importing. Copy the returned `data.library.id` into `spaceId`. If there are multiple AIY data roots, select one with `--user-data-dir PATH`; do not guess which library the user intended.

```text
node out/main/agent-cli.js intake import --input REQUEST.json
node out/main/agent-cli.js intake get --input LOOKUP.json
```

An import request contains the exact SHA-256 of the chosen source file:

```json
{
  "protocolVersion": 1,
  "requestId": "collect-article-001",
  "spaceId": "SPACE_ID_FROM_CAPABILITIES",
  "kind": "ARTICLE",
  "path": "C:\\Outputs\\article.md",
  "expectedSha256": "SHA256_OF_THE_SELECTED_FILE",
  "title": "Article title",
  "provenance": { "application": "codex" }
}
```

Use `IMAGE_MATERIAL` with an explicit `.png` path for a gallery material. The title is optional and defaults to the filename. `provenance.threadId` is optional and must come from known task context, never from guessing or scanning unrelated history.

Markdown must be UTF-8, at most 1 MiB and 1,000,000 characters. This initial lane rejects Markdown image nodes and raw HTML; fenced code is preserved. Images must be ordinary PNG files at most 25 MiB and 4096 × 4096, and must pass complete PNG validation. Directories, network shares, symbolic links, wildcard paths, URLs and other formats are rejected. Reading and object staging use asynchronous filesystem APIs.

AIY compares the source bytes with `expectedSha256`, fixes the target space for the request, then commits the article or material together with its receipt in one transaction. Existing articles are never overwritten. A PNG import creates an actual gallery material, unlike `asset import`, which prepares a reference asset for generation.

The successful JSON response contains `status: "COMMITTED"`, `entityId`, `revisionId` for an article, and `openUrl`. Preserve that receipt. An exact retry with the same request ID reuses it, including when the original source has gone away. Reusing the ID with different content, title, source path or destination fails with a conflict. Intentional new imports require new request IDs; different request IDs can create article copies.

After an uncertain response, look up the original request instead of inventing a new ID:

```json
{
  "protocolVersion": 1,
  "requestId": "collect-article-001",
  "spaceId": "SPACE_ID_FROM_CAPABILITIES"
}
```

The result link opens an article or gallery material in a separate AIY tab. A link for a different space stays pending until the user explicitly switches to that space. A missing or deleted result is not recreated. Development instances require the existing development protocol registration to open links through the OS; direct second-instance arguments can also deliver the link.

This lane performs no generation, translation, publication, directory scanning or automatic collection. Batch review, article attachments, custom Open in registration and packaged CLI installation are separate follow-up work.
