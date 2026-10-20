-- Speaking path (docs/oratoria-trilha.md): practice log (XP, daily goal and
-- streak are computed from it), completed lessons and challenges, and the
-- level of each skill with its next review. Additive only.
CREATE TABLE speech_practice (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('lesson','challenge','levelChallenge','review','warmup','daily','free')),
  ref_id       TEXT,
  -- YYYY-MM-DD in the user's time zone
  local_day    TEXT NOT NULL,
  seconds      INTEGER NOT NULL DEFAULT 0,
  xp           INTEGER NOT NULL DEFAULT 0,
  passed       INTEGER NOT NULL DEFAULT 0 CHECK (passed IN (0, 1)),
  attempt_id   TEXT REFERENCES speech_attempts(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_speech_practice_day ON speech_practice(user_id, local_day);

CREATE TABLE speech_progress (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- lesson, unit challenge or level challenge id
  item_id       TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  best_score    INTEGER CHECK (best_score BETWEEN 0 AND 100),
  completed_at  TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE speech_skills (
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill              TEXT NOT NULL,
  xp                 INTEGER NOT NULL DEFAULT 0,
  level              INTEGER NOT NULL DEFAULT 0,
  last_practiced_on  TEXT,
  next_review_on     TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (user_id, skill)
);

-- The lesson or challenge a talk was recorded in (null: free practice).
ALTER TABLE speech_attempts ADD COLUMN lesson_id TEXT;
