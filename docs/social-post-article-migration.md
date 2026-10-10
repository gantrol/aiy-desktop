# Historical image posts

AIY 0.5.10 uses the existing article format for historical image posts as well as new manuscripts. Opening a library applies the additive `social-post-articles.v1` data upgrade within database revision 11. Previously executed migration steps are unchanged.

The desktop backs up a library containing historical posts with SQLite's backup API, including committed WAL pages, before the upgrade. Schema preparation and conversion run in a worker. Sources and revisions are read in pages of 16; media metadata is fetched once per revision page. Image files are neither decoded nor copied.

The transaction retains work IDs, revision IDs and numbers, timestamps, archive/deletion state, ownership, image order and cover selection. Existing block documents retain their block identities. Plain text and Markdown use the article format's existing Markdown representation; attachment images are appended only if they are not already in the body. No OCR or generated text is involved.

Forms, comments, authors, cover-generation associations, publishing masks, desktop pins and generated frame groups point to the migrated articles. Old workspace locations, calendar sources and reference targets resolve to their article IDs. Fixed reference snapshots and delivery receipts retain their captured payloads. Legacy revision payloads remain available for historical receipt reads and are cleared when the corresponding article is purged. Inserts into retired post tables are rejected so they cannot become a second editing store.

Unsaved post checkpoints are copied into article recovery when that article opens. The old checkpoint is acknowledged only after the new one has been written. An old pending save is not replayed through the retired interface; the article editor compares the preserved input with its saved baseline.

The upgrade aborts atomically on malformed content, identity collisions, missing current revisions or broken foreign keys. It never resolves these conflicts by dropping content. Completion is recorded only after relationship migration and foreign-key checks. Actual libraries are upgraded on application startup; building the application does not migrate user data.
