# Built-in tools directory

AIY Built-in Tools is a host-created subdirectory of Feature extensions. Its members are Capture & Notes (`com.aiy.clipboard-capture`), Natural Watermark (`com.aiy.natural-watermark`), Project Commands (`com.aiy.maintenance-guide`), Embedded Web Runtime (`com.aiy.embedded-web`) and Screen Magnifier (`com.aiy.screen-magnifier`). Each remains a separate selectable capability with its existing settings and permissions.

The shared `builtin-tools` module owns the exact ID/runtime pairs. Membership requires all of: `BUILT_IN` source, capability kind, a listed ID and its matching HOST runtime. Package display names, localization, categories and filesystem folder names do not grant membership. Filtering and search preserve this same boundary; selecting an internal tool reveals its directory. Other extensions remain outside it.

`source-policy` enforces the same identities in the main process. Package inspection, startup/reload discovery and installation reject external packages that claim a reserved ID or runtime. This includes an external language package reusing a reserved capability ID, a differently named package claiming its runtime, and files manually placed in the managed local-extension directory. Invalid packages are skipped without deleting their files or user data. A missing shipped tool is not filled by a local replacement.

The registry's activation gate repeats the source check. Renderer DTOs use the source assigned by the loader, rather than trusting a persisted source label. Sources originate from host-configured roots; plugin manifests and install IPC cannot supply a trusted source. Existing shipped tools retain their enabled state, permissions and configuration when reconciled. Built-in status does not bypass permissions.

Install/update rejection returns `BUILT_IN_IDENTITY`, localized by the existing language catalogs. The restriction controls AIY's extension-loading and directory-membership paths; application-file tampering is outside this boundary. No new database migration or independent plugin version is needed for this release candidate.
