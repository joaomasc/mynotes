-- MyNotes — 0004: state of the semantic index (assistant)
--
-- Additive only: no existing column, row or table is changed or removed.
--
-- The vectors live in Cloudflare Vectorize (index "mynotes-knowledge", one
-- namespace per user, ids "<n|t|r|d|c>:<entity id>:<chunk>"). They are DERIVED
-- from the notes, topics, books, documents and concepts in D1 and can be
-- rebuilt at any time; this table only records what was indexed:
--   source_updated_at  updated_at of the item when it was indexed (a different
--                      value means the item changed and is indexed again)
--   content_hash       hash of the indexed text (unchanged text is not re-embedded)
--   chunk_count        how many vectors the item has (ids 0..chunk_count-1)
--   model              embedding model (changing it re-indexes everything)
-- No text is stored here or in Vectorize: snippets are read from D1.
--
-- Rollback (manual): DROP TABLE knowledge_index and delete the Vectorize index.

CREATE TABLE knowledge_index (
  entity_type        TEXT NOT NULL CHECK (entity_type IN ('note','topic','reading','document','concept')),
  entity_id          TEXT NOT NULL,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_updated_at  TEXT NOT NULL,
  content_hash       TEXT NOT NULL,
  chunk_count        INTEGER NOT NULL,
  model              TEXT NOT NULL,
  indexed_at         TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX idx_knowledge_index_user ON knowledge_index(user_id, entity_type);
