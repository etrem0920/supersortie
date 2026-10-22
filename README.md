# Super Sortie

A new five-wave dogfight every day, the same for every pilot on Earth. Players fly it once, share their tiles, and climb a global leaderboard. Practice runs are unlimited.

## What's in this repository

| Path | What it is |
| --- | --- |
| `game.html` | The game's source. Edit this one. |
| `build.sh` | Builds `public/index.html` from `game.html`. The deploy runs it for you. |
| `public/` | The website as served at supersortie.io: `index.html` (built), `config.js`, `og.png` (share preview), `privacy.html`. |
| `public/config.js` | Site settings: leaderboard URL, share URL, support link, ads, analytics. |
| `server/worker.js` | Leaderboard API (Cloudflare Worker) at api.supersortie.io. |
| `server/coop.js` | Co-op rooms (one Durable Object per room code). |
| `server/arena.js` | Arena: 12-pilot free-for-all rooms, AI pilots, and quick-play matchmaking. |
| `promo/` | Short promo videos: capture script, soundtrack generator, captions. |
| `server/schema.sql` | Database tables (Cloudflare D1). |
| `server/wrangler.toml` | Worker settings: database, custom domain, allowed sites. |
| `server/dev-server.mjs` | Runs the site and the real API locally on SQLite. |
| `server/test/` | API tests: `cd server && npm test`. |
| `.github/workflows/deploy.yml` | Automatic deploys (see below). |

## How updates go live

Every push to `main` deploys automatically through GitHub Actions:

- A change to `game.html`, `build.sh` or anything in `public/` rebuilds `index.html` and uploads the website to Cloudflare Pages.
- A change in `server/` runs the API tests, and only if they pass, deploys the leaderboard Worker.

Progress shows on the repository's **Actions** tab. A run takes about a minute. To redeploy without changing anything, open **Actions → Deploy → Run workflow**.

The workflow needs two repository secrets (**Settings → Secrets and variables → Actions**): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The Worker's own secrets (`ADMIN_TOKEN`, `IP_SALT`) live in Cloudflare and are not touched by deploys.

**Undoing a bad update:** in Cloudflare, open Workers & Pages → supersortie → Deployments, and roll back to the previous deployment. Then revert the commit on GitHub so the next deploy doesn't bring it back.

**Timing:** changes to how waves are generated (enemy counts, conditions, difficulty) alter the day's sortie for everyone who plays afterwards. Push those late in the evening so they start with the next day's sortie. Visual and text changes can go out any time.

## Run it locally

Requires Node 22 or newer.

```sh
./build.sh
node server/dev-server.mjs
# open http://localhost:8787
```

That gives you the full site with a working leaderboard saved to `server/dev.sqlite`. Delete that file to reset.

## Live setup

- **Website:** Cloudflare Pages project `supersortie`, on supersortie.io and www.supersortie.io.
- **Leaderboard:** Cloudflare Worker `supersortie-api` on api.supersortie.io, with D1 database `dailydogfight` (an internal name players never see).
- **Email:** hello@supersortie.io forwards through Cloudflare Email Routing.
- **Analytics:** Cloudflare Web Analytics.

### Game stats

```sh
cd server
npx wrangler d1 execute dailydogfight --remote --command "SELECT day AS sortie, COUNT(*) AS pilots, ROUND(AVG(score)) AS avg_score, MAX(score) AS top_score, SUM(grades NOT LIKE '%x%') AS finished_all_5 FROM scores WHERE hidden = 0 GROUP BY day ORDER BY day DESC LIMIT 14"
```

### Removing a cheated score

```sh
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://api.supersortie.io/api/v1/admin/scores?day=185&name=CheaterName"
```

You can use `deviceId=` in place of `name=`. Hidden scores drop off the board immediately and can be restored in the database by setting `hidden = 0`.

## Hull and fairness

- **Hull:** daily, practice and zen use a 10-point hull. A bullet costs 1, a missile 2 and a ram 1, and you get 1 second of safety after each hit.
  - These values came from simulated runs with scripted average and skilled pilots.
  - Against the old 3-segment hull, the average pilot survives about one wave longer, and the skilled pilot clears all five waves in about 20% of runs instead of 3%.
- **Hull bonus:** the bonus at the end is still worth up to 3,000 points (300 per hull point).
- **Same chance for everyone:** every aircraft is available from day one, and the six in each theater are trade-offs across the same four handling types. Levels unlock looks only (liveries, contrails, titles), so a brand-new pilot has the same shot at #1.

## How the leaderboard works

- One official score per device per day. Practice runs are never posted.
- Each day has a seed, so the waves, ace, conditions and map are the same for everyone. Theater and livery are cosmetic only.
- The server checks every submission. The date must be within a day of the server's date. Grades and wave times must be consistent. The score must be possible given the kill count. Each IP is limited to 30 submissions a day, and IPs are stored only as salted daily hashes.
- The top-100 list is cached at the edge for 20 seconds, so a traffic spike reads the cache instead of the database.
- **Limit:** a determined cheater can still forge a believable score, because the game runs in their browser. The strong fix is to record each run's inputs and replay them on the server. The simulation is already seeded, so this is a contained project. Do it once the leaderboard has prizes or real money attached. Until then, the plausibility checks and the admin endpoint cover it.

## How co-op works

- A host taps **Co-op → Create room** and gets a four-letter code and an invite link (`supersortie.io/?room=CODE`). Up to four pilots join.
- The host picks the theater, wave count (3/5/8/12), difficulty (easy/normal/hard/brutal), conditions, hull and whether an ace guards the last wave. Everyone picks their own plane and readies up.
- Crashed pilots spectate a teammate and are revived with full hull when the wave is cleared. The mission fails only if the whole squad is down at once.
- Each room is a Cloudflare Durable Object that holds the lobby and relays messages. The host's browser runs the enemies and scoring and sends snapshots ten times a second, so **the host must keep the tab open**. If the host leaves, the next pilot becomes host and the squad returns to the lobby.
- Empty rooms delete themselves after 10 minutes. Co-op scores are not posted to the daily leaderboard.
- **Cost:** a 10-minute, four-pilot mission uses about 2,000 Durable Object requests. The free plan allows 100,000 a day (about 50 missions). Workers Paid ($5/month) covers millions.

## Pilot accounts and friends

- **Username and password only**, no email. Sign up or log in from the **Friends** tab. Passwords are hashed with PBKDF2 (10,000 rounds, kept low to fit the free Workers plan's CPU limit; raise `PBKDF2_ITERATIONS` in `server/accounts.js` on Workers Paid). With no email there is **no password reset**.
- An account keeps progress in sync across devices: XP, medals, the ace logbook, streaks, arena career and more. Logging in on a new device keeps the best of both.
- Leaderboard rows from signed-in pilots show a **●** and open their **profile**: level, title, favorite plane, today's sortie, streaks, arena career, ace logbook and medals.
- **Friends**: add someone by username or from their profile. The Friends tab ranks them by today's sortie.
- A signed-in pilot gets one daily per account, even across devices.
- The code is in `server/accounts.js`; the tables are in `server/migrations/0003_accounts.sql`.

## Pilot progression

- Every mode earns XP:
  - **Daily sortie:** 100 plus 1 XP for every 40 points.
  - **Practice:** less XP.
  - **Zen:** XP for kills and minutes flown.
  - **Co-op:** XP for waves cleared and kills.
  - **Arena:** XP for each round, kills, placing and wins.
- Levels go up to 50. They unlock nine contrails, two extra liveries per theater (at levels 8 and 16) and titles. A few titles come from medals and arena wins instead of levels.
- Contrails are drawn from the plane's recent path, so other pilots see yours in co-op and the arena with no extra network traffic. The arena shows your title on the round podium.
- Players who started before levels existed got starting XP for the dailies they had flown and the medals they had earned.
- **Daily challenges:** three a day, the same for everyone and chosen from the date. They span every mode, for example 40 kills, an arena boss or a 4-kill arena streak. Each is worth 250 XP, plus 300 for finishing all three. They live on the Pilot tab, with one line on the home screen.
- Everything is stored on the device, like medals.

## How the arena works

- **Quick play** drops you into the busiest public arena with a free seat, up to 12 pilots. **Private arenas** use a four-letter code and an invite link (`supersortie.io/?arena=CODE`). The creator picks the theater and whether AI pilots join.
- It's a free-for-all with 4-minute rounds. Each round moves to the next theater and ends on a podium, with a 10-second break before the next one.
- Getting shot down puts you back in the air **2.5 seconds** later, somewhere quiet, with a 2-second spawn shield. A kill is worth 100 points, plus 25 for every kill already in your streak. Ending a streak of 3 or more earns a shutdown bonus, and shooting down whoever last got you earns +75 revenge.
- **Arena today** in the Leaderboard tab ranks people (not AI pilots) by kills since midnight UTC. Rounds are saved from the arena to the `arena_scores` table.
- **Power-ups** appear around the map:
  - **Weapons:** missiles, rail gun and mines. Each one fires by itself, so they work the same on phones.
  - **Boosts:** spread guns, rapid fire, shield, repair, afterburner, cloak (nearly invisible, can't be locked), double damage, vampire (each kill restores 5 hull) and shockwave (an instant blast that hurts every pilot nearby).
  - **Overdrive** comes only from a boss: 15 seconds of rapid fire, spread guns, double damage, a shield and full hull at once.
- **Rolling** makes you immune to bullets and breaks missile locks.
- **Dropped connections reconnect.** If a pilot's connection drops, the arena holds their seat, score and streak for 30 seconds while the game reconnects them. Leaving on purpose frees the seat right away. A hidden tab sends a heartbeat so it isn't dropped as idle; pilots who go quiet for 45 seconds are removed. If the server restarts (every deploy restarts it), players are reconnected to a fresh round.
- **A boss** enters each round 35 seconds in, then about every 70 seconds. Each theater has its own: a **Zeppelin** (WW1), a **Destroyer** (Pacific), a **Strategic bomber** (Modern), a **Dreadnought** (Space) and a **Sentinel** (Neon). It has 70 to 110 hull and its turrets fire back at the nearest pilot, so it takes several pilots or a long fight. Rolling dodges its fire. The pilot who finishes it gets +300 points and it drops Overdrive, a weapon and a random power-up.
- **AI pilots** (marked "AI" on the scoreboard) top a public arena up to 8 pilots. They leave as real people arrive.
- **What the arena decides:** each arena is a Cloudflare Durable Object. It runs hull, kills, respawns, power-ups, rounds and the AI pilots, and sends a world update 10 times a second.
- **Who decides a hit:** guns and the rail gun are judged by the shooter. They are capped by a damage budget that matches the real fire rate, plus a range check. Missiles and mines are judged by the target, so a roll really does dodge them.
- **Cost:** each pilot sends about 12 messages a second. Cloudflare bills incoming WebSocket messages at 20 per request, so a full 12-pilot arena costs about 26,000 requests an hour.
  - **Free plan:** 100,000 requests a day, which is about 4 busy arena-hours.
  - **Workers Paid** ($5/month) includes 1 million a month, then $0.15 per million. That is about $4 for every 1,000 busy arena-hours.

## Making money (in priority order)

1. **Cosmetic Pilot Pass.** Liveries are already earned with medals. Add a paid set: animated liveries, exclusive theaters, a gold leaderboard badge. Sell it through a Stripe Payment Link for $3–5 a month or $20 a year. This is how daily games make money without annoying players.
2. **One ad between runs.** The `adsHtml` slot shows on the landing page and results screen only, never mid-flight. Start with AdSense or a game ad network once you have about 10k daily players. Remove ads for Pilot Pass holders.
3. **Supporter link.** Set `supportUrl` in `config.js` (Ko-fi, Buy Me a Coffee, Stripe). It costs nothing and pays from day one.
4. **Sponsored days.** Once traffic is steady, sell a branded daily theme or a named ace ("Today's ace is brought to you by…").
5. **Acquisition.** Daily games with steady audiences get bought by publishers (Wordle went to the New York Times). Owning the streak data and the audience is the asset.

## Growing to millions of players

- **The share text is the growth engine.** Every result carries the tiles, rank and your URL. Put a large "Share" button first, as it is now, and track the `share` event via `track` in `config.js`.
- **Social preview image.** Add a 1200×630 `og:image` so shared links show a picture of the game.
- **Streaks bring people back.** Next steps: a push or email reminder ("Your 6-day streak ends at midnight"), and a "streak freeze" as a Pilot Pass perk.
- **Friends boards.** Private squadrons with a join code, so groups compete among themselves.
- **Launch channels.** Post to r/WebGames, r/incremental_games and Hacker News (Show HN), list on itch.io, and send clips of ace fights to TikTok and Shorts. Daily games spread through group chats, so lead with the share card.
- **Analytics.** Wire `track` to Plausible or PostHog. The events are `run_start`, `run_end`, `share`, `theme` and `score_posted`. Watch three numbers: the share rate, return rate on day 2 and day 7, and the share of players who finish all 5 waves. Tune par times and enemy fire so roughly half of players clear wave 5.
