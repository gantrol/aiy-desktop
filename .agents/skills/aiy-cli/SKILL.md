---
name: aiy-cli
description: Use AIY's local agent CLI to prepare or verify an offline software-development handoff from explicitly supplied text, or to import explicit local reference images, prepare an immutable image-generation draft, start or inspect a persistent generation job, cancel it, or hand completed generated images and post text to Weibo through AIY's browser companion. Use when a user asks Codex to create a sticker or raster image through AIY, send that generated result to Weibo, or trigger AIY command actions. This skill is for the AIY CLI workflow, not direct image generation, MCP, desktop control, or ChatGPT attachment forwarding.
---

# AIY CLI

Use the AIY CLI as a strict orchestration boundary. AIY owns media validation, immutable asset storage, route availability, generation persistence, and output paths.

## Offline development context

For an explicitly requested software handoff, use `handoff prepare` with selected inline text snapshots and `handoff verify` with the returned packet. These commands do not require a worker or an open AIY library; do not call `capabilities` merely to prepare one. Read [Development handoffs](../../../docs/development-handoffs.md) for the example request, extraction of `data`, bounds and failure handling.

Preserve the supplied objective, uncertainty, rejected decisions and acceptance requirements. A supplied repository commit is not independently checked. A consistent digest is not a signature, an approved requirement, a passed test, a job reservation or permission to execute. Do not gather additional library files or credentials to fill missing context. Review the selected text for secrets before sending it to another tool.

## Attachment boundary

- Treat a chat-visible image and a CLI-readable file as different things.
- Accept only an explicit AIY `assetId` or an explicit absolute local file path supplied by the user or a trusted tool result.
- Never invent or infer an attachment path, filename, download directory, clipboard path, or temporary path from visual context.
- If an image has no verified local path or `assetId`, stop before import and ask for the original file path or for the user to import it in AIY.
- Map every image to its path or `assetId` and a short role such as `subject`, `style`, `composition`, or `edit source`. Do not guess this mapping from attachment order.
- Preserve image order. Never join multiple paths with commas; import each path separately.

## Image-generation workflow

1. Run `aiy-agent capabilities` before selecting a route. When working from this repository without a linked command, use `node out/main/agent-cli.js capabilities` after the project has been built.
2. Select only a `READY` route whose live capabilities and limits satisfy the request. Do not hardcode model availability, price, quality modes, or reference limits.
3. For each explicit path, call `asset import` with its own JSON request and stable `requestId`. Record the returned `assetId`, hash, dimensions, MIME type, and the user's role.
4. Restate the complete `assetId` → role mapping before preparing the draft. If any mapping is uncertain, stop.
5. Call `draft prepare` with ordered `{ "assetId", "role" }` entries. Local paths are not accepted at this stage.
6. Call `generation start` with the returned `draftId`. This is the spend-causing step; run it only when the user's request authorizes image generation.
7. Return the `jobId` immediately. Use `job get` for status or output paths. Poll only when the user asked Codex to wait for completion, and avoid rapid polling.
8. Use `job cancel` only for the exact returned `jobId`.
9. When the user asks to send a completed result to Weibo, first require `send-weibo` in the live
   `capabilities.commandActions`, then call `action send-weibo` with that exact `jobId`, the intended post text, and a
   new stable `requestId`. The action attaches only immutable outputs recorded on the job.
10. Treat the action as a draft handoff: it may open the browser Profile configured for Weibo and fill the composer, but
    it never clicks the final publish control. Do not add desktop control to finish publication.

Every input uses `protocolVersion: 1`. Reuse the exact same `requestId` only when safely retrying the exact same normalized command input. Use a new ID after any input change. Parse the JSON envelope and exit code; do not scrape diagnostic text.

Read [references/cli-contract.md](references/cli-contract.md) for commands and request shapes.
