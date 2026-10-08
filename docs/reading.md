# Reader retirement

The reader is removed from the next 0.5.9 release. Application and outline entry points, file capabilities, excerpt IPC, candidate generation and PDF.js are removed together. Outlines use the editor's existing content workspace directly, preventing nested responsive panels from occupying both the bottom and right edges.

## Existing data

Database revision 10 identifies reader turns by the structured `documentTask.readingOutline` marker. On the next library open it deletes those turns, associated process records, context references, calendar records and unconsumed recovery drafts used exclusively by those turns. Drafts used for publication or other creation work are retained. New libraries follow the same forward migration; revisions 1–9 remain unchanged and no reader tables are added.

Renderer startup removes reader positions, selection/candidate caches and reader panel dimensions. Reused drafts, adopted outline text, independently saved notes and original files remain ordinary authored content.

The old reader did not mark draft creation itself. Drafts saved before any successful reader turn cannot reliably be distinguished from ordinary writing in the database and are not deleted by guessing from translated titles.

## Verification boundary

Existing database, conversation, outline and editor-session regressions cover shared behavior. Populated reader-data migration and actual window geometry lack existing dedicated regression coverage. No manual UI check or migration of a real user library has been performed.
