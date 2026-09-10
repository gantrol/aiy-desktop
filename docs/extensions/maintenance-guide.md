# Maintenance Guide

`com.aiy.maintenance-guide` is a host capability extension. Open **Extensions → Maintenance Guide → Feature**. If disabled, enable it and grant its required handbook permission in Settings.

## Projects and handbooks

- Add a project with a name, optional website, release reference, and maintenance notes.
- Link local UTF-8 Markdown or text handbooks. The extension reads the selected file on demand and supports explicit refresh. It does not modify the original handbook.
- Project records and tool links can be edited. Removing a project or unlinking a handbook removes only its association.
- Import projects from JSON exported by this extension. Import appends projects with new identifiers; it does not replace existing records. Repeated import creates additional copies.
- Export includes local file paths, notes, and dashboard URLs, but does not copy handbook contents. Review the JSON before sharing it. Account secrets should not be put in notes or URLs.

The limits are 50 projects, 20 handbooks per project, 256 KiB per handbook, and 4 MiB per project configuration. Only local absolute paths are supported; network shares are excluded. Markdown HTML, images, and links are not executed or loaded. Commands in a handbook remain document content.

## Operations resources

The catalog contains Google Search Console, Google Analytics (GA4), Google Trends, optional Google Ads, Ahrefs Webmaster Tools, Semrush, Bing Webmaster Tools, PageSpeed Insights, Similarweb, Baidu Index, Exploding Topics, GitHub Actions, Cloudflare, Sentry, Uptime Kuma, and Healthchecks.

Use the pencil action to save a project's dashboard URL. Clearing it restores the default website. PageSpeed's default link includes the project's website when set. Other services open their general entry until a dashboard link is configured. Google Ads is disabled per project by default.

These are browser links. Saving a dashboard URL does not connect an account, fetch metrics, start monitoring, deploy code, or create an ad. Opening a link uses the system browser. HTTPS links and localhost HTTP links are accepted; custom protocols and embedded URL credentials are rejected.

## Storage and integration

Data is application-wide, stored under the active Electron user-data directory at `extension-data/com.aiy.maintenance-guide/projects.json`. It is independent of the content library. Reads are deferred until the feature is opened. Writes use the existing asynchronous atomic JSON writer and revision checks. An interrupted write can recover from a backup when the primary file is absent; malformed primary data produces an error instead of being replaced with an empty project list.

The shared Zod contract is in `src/shared/contracts/maintenance-guide.ts`; the host validates every IPC operation against extension activation and required permission. Tool opening accepts a project identifier and catalog identifier, resolving the URL in the main process. Handbook reading accepts stored identifiers instead of an arbitrary renderer-supplied path.

The packaged manifest binds to the host's `maintenance-guide` runtime. Installing this manifest into an older AIY build does not add the runtime implementation. No database migration, dependency, background scheduler, or OAuth connection is introduced.
