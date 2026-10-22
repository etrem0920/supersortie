-- Pilot accounts (username and password only), sessions, friends, and links from scores to accounts.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friends (
  account_id INTEGER NOT NULL,
  friend_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, friend_id)
);
CREATE TABLE IF NOT EXISTS auth_hits (
  hour INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, ip_hash)
);
ALTER TABLE scores ADD COLUMN account_id INTEGER;
ALTER TABLE arena_scores ADD COLUMN account_id INTEGER;
CREATE INDEX IF NOT EXISTS scores_day_account ON scores (day, account_id);
CREATE INDEX IF NOT EXISTS arena_day_account ON arena_scores (day, account_id);
