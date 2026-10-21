-- Canvas (like Obsidian's): free boards of text cards, notes, topics, links
-- and groups. Stored with the mind maps (same favorites, search, backup and
-- topic moves), told apart by `kind`; a canvas may belong to a topic or to a
-- note. Additive only.

ALTER TABLE mind_maps ADD COLUMN kind TEXT NOT NULL DEFAULT 'mindmap' CHECK (kind IN ('mindmap','canvas'));
ALTER TABLE mind_maps ADD COLUMN note_id TEXT REFERENCES notes(id) ON DELETE SET NULL;

CREATE INDEX idx_mind_maps_topic ON mind_maps(user_id, topic_id);
CREATE INDEX idx_mind_maps_note ON mind_maps(user_id, note_id);
