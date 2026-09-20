# External deep links

AIY registers `aiy://` for external application navigation. Internal media continues to use `aiy-media://` and is not an external launch surface.

The gallery route opens its root in the currently active local space:

```text
aiy://open/gallery
```

From a web page:

```html
<a href="aiy://open/gallery">Open the AIY gallery</a>
```

From PowerShell on Windows:

```powershell
Start-Process 'aiy://open/gallery'
```

For a development session on Windows, register the handler for the lifetime of the dev process:

```powershell
npm run dev:deep-link
```

The command removes its development registration on a normal exit. Persistent registration and explicit cleanup are also available:

```powershell
npm run deep-link:register
npm run deep-link:unregister
```

Content routes open an existing item in its named space:

```text
aiy://open/space/SPACE_ID/article/ARTICLE_ID
aiy://open/space/SPACE_ID/material/MATERIAL_ID
aiy://open/space/SPACE_ID/album/ALBUM_ID
```

Articles include outlines. Material links use a saved material ID, not an image asset ID. Content links preserve the current editor by opening another tab; a different space remains pending until the user switches to it.

**Copy link for Agent** includes a content link and local CLI reading instructions. The browser/OS path opens AIY; the [Agent reading path](agent-content.md) returns saved content without UI navigation. Only article and material routes are currently readable through the CLI.

Outside an explicit development registration, the installed package must own the protocol. Browsers may ask for confirmation before handing the link to AIY. Routes are exact: query parameters, fragments, credentials, ports, and unknown paths are rejected.
