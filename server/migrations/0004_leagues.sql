-- Weekly leagues: each week every pilot who flies a daily joins a group of up to 30 in their division.
CREATE TABLE IF NOT EXISTS league_members (
  week INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  account_id INTEGER,
  division INTEGER NOT NULL,
  grp INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (week, device_id)
);
CREATE INDEX IF NOT EXISTS league_group ON league_members (week, division, grp);
