# Content packs with creative works

Use the existing **Import content pack** action: select a directory containing `manifest.json`, inspect the version and changes, then install. Both this UI and the agent CLI call the same content-pack preview and installation service. This is not the standalone `intake import` lane.

## Creation section

The existing manifest contract remains `schemaVersion: 1`, `kind: CONTENT`. A creation-only package needs no dummy dictionary or fixture files:

```json
{
  "schemaVersion": 1,
  "kind": "CONTENT",
  "key": "concept-example",
  "id": "local.concept-example",
  "version": "0.1.0",
  "displayName": "Concept example",
  "description": "A concept in two forms",
  "contentKinds": ["CREATION"],
  "defaultRoles": [],
  "source": { "creations": "creations.json" }
}
```

`creations.json` declares one album, its creation items, primary works and inline Markdown:

```json
{
  "schemaVersion": 1,
  "title": "Concept example",
  "titleLocale": "en",
  "description": "A concept in two forms",
  "creationItems": [{ "key": "concept", "primaryWorkKey": "article", "workKeys": ["article", "outline"] }],
  "works": [
    {
      "key": "article",
      "kind": "ARTICLE",
      "title": "Concept",
      "file": "concept.md",
      "markdown": "# Concept\n\n[Outline](outline.md)"
    },
    {
      "key": "outline",
      "kind": "OUTLINE",
      "title": "Concept outline",
      "file": "outline.md",
      "markdown": "- Concept\n  - Purpose\n  - Example"
    }
  ]
}
```

Limits: 4 MiB JSON, 25 creation items, 50 works, 1,000,000 Markdown characters per work and 3,000,000 in total. Work keys and logical filenames must be unique, and each work belongs to exactly one item. A primary work must be a member. The item uses the primary work's existing naming rule. ARTICLE and OUTLINE share the structured document model; OUTLINE explicitly selects the outline editor.

The package loader reads declared package-relative files with size and containment checks. `file` inside a work is only a logical filename, not another file read. A link to a declared filename (optionally `./` prefixed) becomes the destination-space AIY work address. HTTP(S), mail, telephone and validated AIY addresses remain as authored. Undeclared files, fragments, file URLs, raw HTML, images and existing AIY reference identities are rejected in this first creation section. Existing dictionary/example packages retain their existing formats.

## Releases and local editing

The album layout is one release item; every work is an `ARTICLE_REVISION` item with its own source hash and actual local revision mapping. Stable local identities derive from the pack and member keys. An identical install reuses the selected release rather than creating another album. Content, release registration, object mappings and installation selection commit in one transaction.

Changed package work content is staged as another immutable revision. Selection advances only a work still following a package revision and without local comments or archive state. Local edits and discussions remain intact. Revision allocation includes staged revisions so a subsequent user save cannot reuse their revision numbers.

This first version does **not** automatically migrate changed album configuration, grouping, member lists or primary choices. Such upstream changes, or missing/deleted local members, appear as blocking conflicts and cannot be applied. Existing local organization is not overwritten. Disabling/removing a pack does not silently delete these editable creations.

Markdown has no durable node identifiers. Reimporting the same source preserves generated IDs; republishing changed Markdown assigns new IDs rather than guessing that a block at an old position is the same block. Normal editing inside AIY continues to use the document's block identities. This format does not package fixed-reference dependencies, media, comments, or establish synchronized editing. The Markdown authoring/export files remain independently readable.

## CLI entry to the same workflow

Require `data.contentPacks` from `capabilities`. Use the selected library's actual ID:

```json
{ "protocolVersion": 1, "spaceId": "SELECTED_SPACE_ID", "path": "C:\\Outputs\\concept-pack" }
```

```text
node out/main/agent-cli.js pack preview --input PREVIEW.json
```

After inspecting the returned preview, use the same request fields plus `expectedContentHash` from `targetContentHash` and `expectedPackageFingerprint` from `packageFingerprint`:

```text
node out/main/agent-cli.js pack apply --input APPLY.json
```

An explicit data root may be selected with `--user-data-dir PATH`. The CLI checks the space and uses the same preview fingerprint checks as the UI. Its successful result contains `packId`, `releaseId`, and `version`; installation records belong to the existing content-pack system, not a separate intake receipt. If a response is uncertain, preview the same package again and inspect `currentReleaseId`/`currentVersion` before deciding whether to retry. A protocol mismatch means the running application needs the matching build; do not bypass it or mutate its database directly.
