-- Ghost replays of the day's best daily runs, so pilots who have flown can race them in practice.
CREATE TABLE IF NOT EXISTS ghosts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (day, device_id)
);
CREATE INDEX IF NOT EXISTS ghosts_day_score ON ghosts (day, score DESC);
