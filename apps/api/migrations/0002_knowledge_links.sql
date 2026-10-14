-- MyNotes — 0002: books as study spaces, tags and presentation layouts
--
-- Additive only: no existing column, row or table is changed or removed.
--
-- 1. A book's review ("Minha resenha") and its page annotations are NOTES
--    attached to the reading. They reuse the note editor, autosave, history,
--    internal references (note_links), backlinks and search, so content keeps
--    a single source of truth. `role` tells them apart:
--      note        ordinary note (every existing row)
--      review      the general review of `reading_id`
--      annotation  an annotation of `page` of `reading_id`
--    Deleting the reading keeps these notes (reading_id becomes NULL).
-- 2. note_tags: #tags found in note content (derived, rebuilt on every save,
--    like note_links). `index_version` marks notes indexed by the current
--    rules; older rows (0) are indexed lazily by the API.
-- 3. view_layouts: node positions / collapsed branches of generated views
--    (topic mind maps). Purely visual: never read to infer hierarchy or
--    relations, which live in topics.parent_id and relations.
--
-- Rollback (manual, after exporting a backup): the new tables can be dropped;
-- the new columns are ignored by older API versions.

ALTER TABLE notes ADD COLUMN role TEXT NOT NULL DEFAULT 'note'
  CHECK (role IN ('note', 'review', 'annotation'));
ALTER TABLE notes ADD COLUMN reading_id TEXT REFERENCES readings(id) ON DELETE SET NULL;
ALTER TABLE notes ADD COLUMN page INTEGER CHECK (page IS NULL OR page BETWEEN 1 AND 100000);
ALTER TABLE notes ADD COLUMN annotation_type TEXT
  CHECK (annotation_type IS NULL OR annotation_type IN ('summary', 'interpretation', 'critique', 'question', 'quote'));
-- Passage the annotation refers to (selected in the PDF or typed).
ALTER TABLE notes ADD COLUMN quote TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN index_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_notes_reading ON notes(reading_id, page) WHERE reading_id IS NOT NULL;
CREATE INDEX idx_notes_index_version ON notes(user_id, index_version);

CREATE TABLE note_tags (
  note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  -- Normalized: lowercase, no accents ("Crítica" -> "critica")
  tag      TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX idx_note_tags_tag ON note_tags(tag);

CREATE TABLE view_layouts (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- e.g. "mindmap:topic:<topic id>"
  view_key    TEXT NOT NULL,
  -- JSON: { positions: { [nodeKey]: { x, y } }, collapsed: [nodeKey], viewport }
  data        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, view_key)
);
