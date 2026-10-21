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

## How the leaderboard works

- One official score per device per day. Practice runs are never posted.
- Each day has a seed, so the waves, ace, conditions and map are the same for everyone. Theater and livery are cosmetic only.
- The server checks every submission. The date must be within a day of the server's date. Grades and wave times must be consistent. The score must be possible given the kill count. Each IP is limited to 30 submissions a day, and IPs are stored only as salted daily hashes.
- The top-100 list is cached at the edge for 20 seconds, so a traffic spike reads the cache instead of the database.
- **Limit:** a determined cheater can still forge a believable score, because the game runs in their browser. The strong fix is to record each run's inputs and replay them on the server. The simulation is already seeded, so this is a contained project. Do it once the leaderboard has prizes or real money attached. Until then, the plausibility checks and the admin endpoint cover it.

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
