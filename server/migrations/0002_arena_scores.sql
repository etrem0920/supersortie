-- Arena results: one row per device per day, added up round by round.
CREATE TABLE IF NOT EXISTS arena_scores (
  day INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  plane TEXT,
  livery INTEGER,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  rounds INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  best_round INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, device_id)
);
CREATE INDEX IF NOT EXISTS arena_scores_day_kills ON arena_scores (day, hidden, kills DESC);
