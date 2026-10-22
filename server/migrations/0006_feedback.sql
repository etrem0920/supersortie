-- Messages sent from the in-game feedback form.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  contact TEXT,
  username TEXT,
  device_id TEXT,
  page TEXT,
  ip_hash TEXT,
  emailed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS feedback_time ON feedback (created_at DESC);
