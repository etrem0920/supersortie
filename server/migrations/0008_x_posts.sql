-- Posts to the game's X account: one row per day and slot (06:07, 14:07, 22:07 UTC).
CREATE TABLE IF NOT EXISTS x_posts (
  slot_key   TEXT PRIMARY KEY,          -- "<day>-<recap|live|board>"
  text       TEXT NOT NULL,
  status     TEXT NOT NULL,             -- posted | failed | draft (keys not set up yet)
  tweet_id   TEXT,
  error      TEXT,
  created_at INTEGER NOT NULL
);
