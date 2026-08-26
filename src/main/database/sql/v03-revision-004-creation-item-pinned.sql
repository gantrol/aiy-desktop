-- Completes creation_items written by pre-release revision-4 builds before
-- creator-library items gained independent pin state.
ALTER TABLE creation_items
ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1));
