# AIY Design Lab

A small, isolated component workbench using the existing Vite, React and Tailwind dependencies. It imports production components rather than maintaining a second implementation. The examples do not connect to a real library, call Electron IPC, install Storybook or add a runtime dependency.

## Run

Install the repository dependencies with `npm ci`, then run:

```sh
npm run design:dev
```

Open the local address printed by Vite. A media example is `http://127.0.0.1:4177/?case=animation&locale=zh&width=320&motion=auto`.

The media URL controls the case, locale (`zh` or `en`), width (`280`, `320`, `480`, `640`), theme (`light` or the development-only `dark` probe), and motion (`auto`, `play`, `still`). Dark is not a released product theme.

```sh
npm run design:build
```

The build writes `.tmp/design-lab/`. A successful build alone does not establish browser or native acceptance.

## Album covers and previews

Open `http://127.0.0.1:4177/albums.html`. Query parameters `locale=zh|en`, `theme=light|dark` and `view=library|creation|detail|list|tree` select the inspection surface. Dark remains a development probe, not a released theme.

This entry mounts the actual collection grids, album headers, content list and tree preview. The media adapter substitutes only known `album-demo-*` IDs with original geometric fixtures; it never reads a real library or requests a source video. Other Design Lab media cases retain their existing transport. The fixtures cover empty, one-, two- and multi-image albums, portrait/landscape/square images, a video poster, a long title and a failed image. Counts describe the fixture album, not the number of cover previews.

Use the controls to compare rows/columns and busy state. Opening, moving and lifecycle commands report the selected identity in the local status line; they do not save or delete anything. Native desktop pinning has no bridge in this workbench and is not a browser acceptance case.

Review the unchanged card/title footprint during hover, explicit preview versus navigation, Escape/focus return, healthy images versus bounded failure glyphs, reduced motion, touch-scroll safety and narrow headers. Cover geometry must not depend on image load completion. Detailed interaction checks stay outside the production smoke lane.

## AIY outline example and application entry

Open `http://127.0.0.1:4177/outline.html` after starting Design Lab. Add `?locale=en` for English controls. The example document itself uses AIY's Chinese requirements, concepts, design decisions and acceptance cases.

In the application, open the shared block editor for a document and select **大纲 / Outline** above the editor. The outline panel contains the **AIY：需求 → 概念 → 设计 → 验收** example button. This is the document outline, not the existing library outline for organizing albums and creation items.

The example edits the real editor document. Triangles collapse branches, dots focus a branch, titles locate the corresponding content, and breadcrumbs return to an ancestor. Arrow keys and Home/End navigate visible rows; Enter opens the block, Shift+Enter focuses a branch, and Space toggles its expansion. Search retains matching ancestors without rewriting the normal collapsed state. These tree commands do not replace text-editing shortcuts.

Example edits remain in that example instance; closing it does not save them into the library. Export Markdown to keep readable content or JSON to preserve document-scoped block IDs and internal links. Markdown export retains internal-link labels but does not emit unsupported block URLs. Reset requires confirmation. No existing work is overwritten when opening or resetting the example.

### Production components

| Responsibility                                                   | Location                                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Reusable tree navigation and keyboard surface                    | `src/renderer/components/outline/OutlineTree.tsx`                                                    |
| Read-only document-to-outline projection and exact block capture | `src/shared/content-outline.ts`                                                                      |
| Live editor outline, search, focus and document-local navigation | `src/renderer/features/content-editor/ContentDocumentOutline.tsx`                                    |
| Application entry shared by document editor surfaces             | `src/renderer/features/video-documents/VideoDocumentEditorSurfaces.tsx`                              |
| Editable example and its fixture                                 | `src/renderer/features/content-editor/AIYOutlineExample.tsx`, `src/shared/examples/aiy-outline.ts`   |
| Reference target contracts and saved snapshot service            | `src/shared/contracts/content-source.ts`, `src/main/database/creations/content-reference-targets.ts` |
| Reference selection and snapshot/source/use-site viewing         | `src/renderer/features/content-editor/ContentReferencePicker.tsx`, `ContentReferenceSource.tsx`      |

The tree component owns navigation, not content identity, storage or arbitrary moves. The existing `creation-outline` feature owns library organization. Reusing a tree surface does not give every displayed object the same move, edit or delete command.

### Reference scope in this implementation

From the existing fixed-reference picker, choose **Works**, **Creation items** or **Albums**. Inspect the saved source, then choose a supported block, a heading section, the whole work, or a member list. Confirming a reference uses that preview's version; reloading the source is an explicit separate action. Failed selections clear the prior insertable preview, and closing the picker prevents late results from being inserted.

| Target          | Captured result                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Document block  | Exact saved block ID and revision, selected content and required media. Missing or ambiguous IDs fail without title matching. |
| Heading section | The heading and its following section, bounded by the next same-or-higher-level heading.                                      |
| Creation item   | Ordered form/member identities and available version information; not a writable copy of the primary work.                    |
| Album           | Direct members and their order. A child album remains a member, not a recursive import of all descendants.                    |

Member snapshots use a manifest version rather than pretending that a collection has a document revision. The current capture limit is 200 members; larger selections fail explicitly. These snapshots do not package every member's source project and dependencies. Legacy text-range references remain readable.

**Current article use sites** scans actual saved references in current active articles, with pagination. An unused capture is not a backlink. This is not a complete historical or cross-media graph. Source inspection and use-site inspection are read-only; closing the dialog returns to its invoking editor. Source loss keeps the captured content rather than rebinding to a similarly named object.

## Add a case

Register a stable identifier, fixture and rules in `cases.json`. Resolve labels through `messages.designLab.cases` in the English catalog and corresponding language pack. Keep examples synthetic and bounded. Extend an existing production component rather than copying its markup or styles into the workbench. Never add a user's media, local paths or library credentials to examples.

Use the case's rules as review and test criteria. The large SVG case must never request its expensive original. The animated case must visibly change frames, stop on request and return to a poster when offscreen. The visibility case must distinguish temporary hiding from explicit collection.

## Check the workbench

```sh
npm run typecheck
npm run lint
npm run test:smoke
npm run verify:test-boundary
npm run build
npm run design:build
```

Detailed behavior checks and their evidence are maintained separately from this workbench. The repository retains only its generic startup and storage smoke lane.

## What each check proves

`npm run typecheck` checks the shared and renderer contracts. `npm run test:smoke` covers only generic startup and storage behavior. `npm run build` builds the Electron application. `npm run design:build` builds this independent workbench.

The workbench does not replace Windows acceptance for native dragging, always-on-top behavior, display scaling, IME composition, file protocols or multiple editor windows. A browser layout check is not a native-window or real-channel publishing test.

Keep validation results and their exact commit in the pull request or CI run. Do not mark an unexecuted browser or native test as passing.

## 插件与权限

打开 `/extensions.html`，英文为 `/extensions.html?locale=en`。页面复用真实插件列表、详情头和权限面板，包含必要权限缺项、准确网络目标、运行时范围和失败反馈。勾选不授权；批量撤销只处理可见且已授权的项，确认前变化会阻止提交。

这些是内存示例，不连接 Desktop API。真实安装与本机 HTTP 往返见 [本地草稿接收器](../docs/extensions/examples/local-draft-receiver/README.md)。详细回归在独立私有 review 工件中，主仓继续遵守通用 smoke 边界。
