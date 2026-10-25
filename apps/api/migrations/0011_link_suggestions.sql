-- Suggested links (docs/grafo-memoria.md): pairs of notes or concepts close
-- in meaning (Vectorize neighbours) that are not linked yet, with the
-- relation the AI suggests. Additive only.
--
--   link_suggestions   one pair (a, b), stored in a fixed order (a < b by
--                      "type:id"). status: open, accepted (a relation was
--                      created) or dismissed (never suggested again).
--                      hidden = 1 when the AI found no real connection.
--   knowledge_index.links_hash   content_hash of the item when its neighbours
--                      were last searched (a different hash: search again).
--
-- Rollback (manual): DROP TABLE link_suggestions; the triggers and the column
-- are then harmless (drop the triggers too).

CREATE TABLE link_suggestions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  a_type        TEXT NOT NULL CHECK (a_type IN ('note','concept')),
  a_id          TEXT NOT NULL,
  b_type        TEXT NOT NULL CHECK (b_type IN ('note','concept')),
  b_id          TEXT NOT NULL,
  score         REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed')),
  kind          TEXT CHECK (kind IS NULL OR kind IN ('related','references','depends_on','part_of','supports','contrasts','example_of')),
  direction     TEXT NOT NULL DEFAULT 'ab' CHECK (direction IN ('ab','ba')),
  reason        TEXT NOT NULL DEFAULT '',
  hidden        INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  explained_at  TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (user_id, a_type, a_id, b_type, b_id)
);
CREATE INDEX idx_link_suggestions_a ON link_suggestions(user_id, a_type, a_id, status);
CREATE INDEX idx_link_suggestions_b ON link_suggestions(user_id, b_type, b_id, status);
CREATE INDEX idx_link_suggestions_open ON link_suggestions(user_id, status, score DESC);

ALTER TABLE knowledge_index ADD COLUMN links_hash TEXT;

-- Pairs go with the items (polymorphic: no foreign keys).
CREATE TRIGGER trg_notes_link_suggestions AFTER DELETE ON notes BEGIN
  DELETE FROM link_suggestions WHERE (a_type = 'note' AND a_id = OLD.id) OR (b_type = 'note' AND b_id = OLD.id);
END;

CREATE TRIGGER trg_concepts_link_suggestions AFTER DELETE ON concepts BEGIN
  DELETE FROM link_suggestions WHERE (a_type = 'concept' AND a_id = OLD.id) OR (b_type = 'concept' AND b_id = OLD.id);
END;
