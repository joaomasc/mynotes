-- Speaking path, stage 3 (docs/oratoria-tecnico.md): the examining board and
-- exercise variants written by the model. Additive only.

-- A board answer points to the talk the questions were about.
ALTER TABLE speech_attempts ADD COLUMN parent_id TEXT REFERENCES speech_attempts(id) ON DELETE SET NULL;
-- Questions the board asked about this talk (JSON array of strings).
ALTER TABLE speech_attempts ADD COLUMN questions_json TEXT;

-- Extra exercises for reviews, generated per skill and served once each.
-- A cache: left out of the backup, it is regenerated on demand.
CREATE TABLE speech_exercise_variants (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill        TEXT NOT NULL,
  content_json TEXT NOT NULL,
  used_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_speech_variants_skill ON speech_exercise_variants(user_id, skill, used_count);
