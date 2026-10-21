-- Super Sortie leaderboard schema (Cloudflare D1 / SQLite)
CREATE TABLE IF NOT EXISTS scores (
  day        INTEGER NOT NULL,          -- sortie number (#1 = 2026-04-20)
  device_id  TEXT    NOT NULL,          -- random id generated on the player's device
  name       TEXT    NOT NULL,          -- callsign, sanitized
  score      INTEGER NOT NULL,
  grades     TEXT    NOT NULL,          -- five tile codes, e.g. "ggyox"
  time_s     REAL    NOT NULL,          -- total flight time in seconds
  theme      TEXT    NOT NULL,
  hp         INTEGER NOT NULL,
  kills      INTEGER NOT NULL,
  mod        TEXT,
  wave_times TEXT,                      -- JSON array of per-wave clear times
  ip_hash    TEXT,                      -- salted, per-day hash; never the raw IP
  created_at INTEGER NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,-- 1 = removed by a moderator
  PRIMARY KEY (day, device_id)
);
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (day, hidden, score DESC);

CREATE TABLE IF NOT EXISTS ip_hits (
  day     INTEGER NOT NULL,
  ip_hash TEXT    NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ip_hash)
);
