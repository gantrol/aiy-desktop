# External deep links

AIY registers `aiy://` for external application navigation. Internal media continues to use `aiy-media://` and is not an external launch surface.

The first supported route opens the root of the gallery in the currently active local space:

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

Outside an explicit development registration, the installed package must own the protocol. Browsers may ask for confirmation before handing the link to AIY. The current route is exact: query parameters, fragments, credentials, ports, and unknown paths are rejected.
