-- Each score remembers the plane flown, its livery, and the pilot's favorite plane,
-- so the leaderboard can show a plane "profile picture" for every pilot.
ALTER TABLE scores ADD COLUMN plane TEXT;
ALTER TABLE scores ADD COLUMN livery INTEGER;
ALTER TABLE scores ADD COLUMN fav TEXT;
