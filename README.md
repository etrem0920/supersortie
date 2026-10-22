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
- **Same chance for everyone:** every aircraft is available from day one, and the nine in each theater are trade-offs across the same four handling types. Levels unlock looks only (liveries, contrails, titles), so a brand-new pilot has the same shot at #1.

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

## Aces

Each day's ace flies its own paint scheme (12 palettes × 6 patterns, chosen from the day), so every ace in the logbook looks different. The logbook shows a small picture of each one.

## Shop and crates (cosmetic only)

- **Credits** come from playing: a daily (300 + score/30), arena rounds (60 + 20 per kill, +150 for a win), co-op missions (150, +150 for a win, +6 per kill), practice and zen, challenges (200 each, +400 for all three), level-ups (300), medals (250), the season pass, daily rewards and league results. A typical day of play earns about one Ace crate. New pilots start with 1,500. There is no way to buy credits with money.
- **Crates** per theater in three tiers: Standard (200), Premium (600) and Ace (1,500). The odds are shown in the shop. A CS-style reel spins and lands on your prize, which you keep (and can equip right away) or sell back for its rarity value (25 to 10,000; on average always less than the crate cost, so selling can't farm credits). Odds, Common to Apex (%): Standard 53 / 26 / 14 / 5.3 / 1.53 / 0.15 / 0.02, Premium 0 / 43 / 33 / 16 / 7.12 / 0.8 / 0.08, Ace 0 / 0 / 44 / 34 / 18.1 / 3.5 / 0.4. Average sell-back: 92, 239 and 511. Duplicates are sold automatically if you close the reveal; new items are twice as likely as ones you own.
- **Prizes:** 126 plane skins per theater (eleven for each standard plane and nine for each crate plane; the rarer, the fancier: common bands and tips, rare camo, epic tiger stripes and sharkmouths, legendary gold and chrome with sparkles), 9 kill effects that play when you shoot someone down and that other pilots see (Confetti Pop and Smoke Ring, Fireworks and Pixel Burst, Shockwave, Lightning Strike and Black Hole, Supernova, and the Mythic Orbital Strike), and originally 18 plane skins per theater (two for each standard plane, with patterns like hex, carbon, chrome, stars and lightning bolts; legendaries shed sparkles), three crate-only planes per theater (Mythic: Fokker E.III, Sopwith Dolphin, SSW D.IV; Me 262, Ho 229, P-82; SR-71, Su-47, F-117; plus fictional Space and Neon ships), 8 contrails (helix, pixel, lightning, galaxy, inferno and more) and 14 bullet skins (including the twin-beam Neon Twin and the glittering Stardust). Crate planes use the same four handling types as every other plane.
- **More prizes:** a Legendary and a Mythic skin for every crate plane (new animated holo and galaxy finishes), the Bubble Stream, Neon Hearts, Aurora and Black Hole contrails, and the Bubblegum, Venom Twin, Chain Lightning, Phoenix Fire (Mythic) and Singularity (Mythic) bullets.
- **Apex**, the rarity above Mythic: one plane per theater (Junkers D.I, Do 335 Pfeil, SR-72 Darkstar, Celestial Dreadwing, Neon Phoenix). Each comes with its own animated skin, bullets, contrail and kill effect, which unlock with the plane (`APEX` and `APEX_GRANT` in `game.html`) and go if you sell it. They fly like one of the usual four handling types.
- **Previews:** the hangar showcase is live: your plane in its current skin, contrail and bullets, with your kill effect every few seconds (click it to replay). In the shop you can preview items you don't own yet. Equipped items have a green check.
- Collector medals: Collector (keep 25 crate items), Hoarder (100), Mythic pull, Loyal (a 7-day reward streak), Ghostbuster and Season ace.
- The inventory and credits sync with your account. Like the rest of progression they live in the browser, so a determined cheater could edit them; everything they could unlock is cosmetic.

## Daily rewards and the season pass

- **Daily reward:** after you fly the daily and return to the hangar, a 7-day reward track pops up: 150, 200, 300 plus a free Standard crate, 350, 400, 500, then 750 plus a free Premium crate on day 7. Missing a day starts it again at day 1. Free crates are kept as tokens (`store.tokens`), and opening a crate uses a token before it spends credits. The Shop tab gets a red dot when a token is waiting or you can afford a crate you haven't looked at today.
- **Season pass:** free, 30 tiers, resets on the 1st of every month. All XP from every mode also fills it, at 500 XP per tier. Tiers pay 160 to 450 credits, with free crates at 5, 10, 15 and 25. Tier 20 gives the Season Ace title and tier 30 the Victory Ribbon contrail plus an Ace crate. Both are exclusive and stay with you; in later seasons those tiers pay 1,000 extra credits instead. Progress is shown under Pilot and on the home strip.

## Ghost race

After you fly the daily, you can race a ghost of a top run on today's map ("Race today's ghosts" on the home card, or on the results screen). A ghost race is a practice run, so it never touches the leaderboard. Beating any ghost pays 250 credits once a day.
- The client samples the daily's flight path every 200 ms: 8 bytes per sample (x, y, heading, roll/dead flags, score). It uploads the recording right after your score posts.
- The server (`server/ghosts.js`, table `ghosts` in `server/migrations/0005_ghosts.sql`) only accepts a ghost for a device that has a score that day. The recording's length must match the scored flight time, and its score track can't go down or end above the posted score. Only the top 20 per day are kept.
- Endpoints: `POST /api/v1/ghost`, `GET /api/v1/ghosts?day=` (list) and `GET /api/v1/ghost?day=&id=` (one recording).
- Your own ghost is kept on your device, so you can always race yourself.

## Music

Each era has its own procedural soundtrack, made in WebAudio by a small step sequencer (`Music` in `game.html`): a march for WWI, swing for WWII, rock for the modern theater, ambient arpeggios for space and synthwave for neon. The hook plays louder and on every phrase during the ace wave. The music is muffled while paused or shot down and stays silent on the menu. Toggle it with "Music on/off" in the header (desktop) or the pause menu. "Sound off" mutes everything.

## Zen settings

Zen opens a settings sheet first, with three presets: Calm (the default: a few planes that don't shoot back, power-ups, soft music, a sunset, a minimal HUD and a slower cruise), Classic (the original zen) and Sandbox. Each option can also be set on its own: enemy planes (none, few, normal, swarm), enemy fire, aces, power-ups (rapid fire, spread shot, shield, star shower, magnet), an invincible hull, HUD, music (calm, theater, off), ambience (clear, sunset, night, rain), speed and clouds. Saved in `store.zenCfg`.

## Military mode

The "Military mode" toggle in the header (and the pause menu) swaps in real military terms: OPFOR, bandits, HVT, phases, TOT, AOR names like INDO-PACIFIC, OPORD numbers and date-time groups. It adds a flight-data line to the HUD (heading, speed, angels, G, grid and Zulu time), target brackets and SPLASH callouts. Looks only (`MIL` in `game.html`).

## Accounts across devices

Each save to `PUT /api/v1/me/profile` carries the revision the device last saw. If another device saved since, the server answers 409 with its copy, and the client merges three ways against what it last synced: credits, crate tokens and the inventory replay this device's changes on top of the account, so credits never duplicate and sold items stay sold. Loadout picks that changed here win; the rest follow the account. Tabs pick up changes when you come back to them, and each plane remembers its own skin (`store.planeLiv`).

## Creator badge

The account in `CREATORS` (`server/creators.js`, mirrored in `game.html`) gets a "◆ Creator" badge and a highlighted row on the daily, arena and league boards, the friends list, pilot profiles and the ghost picker, plus a colour-cycling "◆ NAME · CREATOR" tag above their plane in the arena. It goes by account username, which is unique, so a guest using the same callsign doesn't get it; the arena flag is set by the Worker from the signed-in account.

## Feedback

The home screen has a feedback form (idea, bug or other, plus an optional email). Messages go to `POST /api/v1/feedback`, which stores them in the `feedback` table (`server/migrations/0006_feedback.sql`). Read them with `GET /api/v1/admin/feedback` and the `ADMIN_TOKEN` bearer. To have each one emailed as well, turn on Cloudflare Email Routing for supersortie.io, verify your inbox as a destination, then add a `send_email` binding named `FEEDBACK_MAIL` and a `FEEDBACK_TO` var to `server/wrangler.toml`; `server/feedback.js` sends through it when it's there.

## Weekly leagues

Weeks run Monday to Sunday (UTC). Your first daily of the week puts you in a group of up to 30 pilots in your division (Bronze, Silver, Gold, Platinum, Diamond, Ace). Your league score is the sum of your dailies that week. The top 5 of each group move up and the bottom 5 move down; the result pays credits (1,000 up, 400 stay, 150 down) the next time you open the game. The League tab shows the whole ladder, what each finish pays and where you stand. Code: `server/league.js`, table `league_members` (`server/migrations/0004_leagues.sql`).

## Account settings

Signed-in pilots fly under their username (the callsign field is locked). The Friends tab's **Settings** has: profile picture (a squadron badge in a colour, or any plane you've flown in its livery), change password (signs out other devices), log out, log out everywhere, and delete account (needs the password; scores stay on the boards without the name). Leaderboard rows from pilots without an account say "not registered".

## Pilot progression

- Every mode earns XP:
  - **Daily sortie:** 100 plus 1 XP for every 40 points.
  - **Practice:** less XP.
  - **Zen:** XP for kills and minutes flown.
  - **Co-op:** XP for waves cleared and kills.
  - **Arena:** XP for each round, kills, placing and wins.
- Levels go up to 50. They unlock twelve contrails, nine extra liveries per theater (camo patterns such as splinter, digital, tiger stripes, sharkmouth, D-Day stripes and flames), squadron badges for your profile picture, and titles. Some titles come from medals and arena wins instead of levels. Level-ups and big moments get a confetti burst.
- **Daily Elite livery:** finishing in the top 10% of a day's daily unlocks a gold livery in every theater until the next sortie. Arena and co-op check the leaderboard (`server/elite.js`) before showing it to anyone else.
- **Planes:** nine per theater. WWI, WWII and Modern are all real aircraft (Fokker D.VII, S.E.5a, Sopwith Snipe; P-47, Bf 109, A6M Zero; F-22, YF-23, Su-57, plus the Eurofighter Typhoon, F-35 and F-47). Space and Neon stay fictional. Enemies in each theater fly that era's opposition.
- Contrails are drawn from the plane's recent path, so other pilots see yours in co-op and the arena with no extra network traffic. The arena shows your title on the round podium.
- Players who started before levels existed got starting XP for the dailies they had flown and the medals they had earned.
- **Daily challenges:** three a day, the same for everyone and chosen from the date. They span every mode, for example 40 kills, an arena boss or a 4-kill arena streak. Each is worth 250 XP, plus 300 for finishing all three. They live on the Pilot tab, with one line on the home screen.
- Everything is stored on the device, like medals.

## How the arena works

- **Quick play** drops you into the busiest public arena with a free seat, up to 12 pilots, so you land with whoever is already flying. The **Live arenas** list (the server browser) shows every public arena with people in it, its theater, round clock and top pilots; pick one to join it. **Private arenas** use a four-letter code and an invite link (`supersortie.io/?arena=CODE`). The creator picks the theater and whether AI pilots join.
- It's a free-for-all with 4-minute rounds. Each round moves to the next theater and ends on a podium, with a 10-second break before the next one.
- Getting shot down puts you back in the air **2.5 seconds** later, somewhere quiet, with a 2-second spawn shield. A kill is worth 100 points, plus 25 for every kill already in your streak. Ending a streak of 3 or more earns a shutdown bonus, and shooting down whoever last got you earns +75 revenge.
- **Arena today** in the Leaderboard tab ranks people (not AI pilots) by kills since your local midnight, the same day boundary as the daily: the client sends its timezone offset when it joins, and each round is saved to `arena_scores` under that pilot's local day (`localDay` in `server/day.js`). The board shows one line per pilot: an account's devices are added together, and guests are grouped by callsign.
- **Power-ups** appear around the map:
  - **Weapons:** missiles, rail gun and mines. Each one fires by itself, so they work the same on phones.
  - **Boosts:** spread guns, rapid fire, shield, repair, afterburner, cloak (nearly invisible, can't be locked), double damage, vampire (each kill restores 5 hull) and shockwave (an instant blast that hurts every pilot nearby).
  - **Tactical:** EMP (strips weapons and boosts from everyone nearby), wingman drone (orbits you and shoots whoever comes close for 15 seconds) and flares (missiles lose you and mines stay quiet for 12 seconds).
  - **Overdrive** comes only from a boss: 15 seconds of rapid fire, spread guns, double damage, a shield and full hull at once.
- **Rolling** makes you immune to bullets and breaks missile locks.
- **No clones.** If a connection drops without the arena noticing, the reconnect (same token, or the same device once the old connection has gone quiet) takes over the old seat instead of adding a second copy of the pilot. Pilots who go quiet are removed straight away rather than waiting on a close handshake.
- **Restarts are seamless.** The arena saves its round in storage and each pilot's score on their connection, so if Cloudflare restarts the object mid-round the round carries on and pilots stay in the air.
- **Every round starts with a 3-2-1.** The screen drains to grey, counts down, then floods back into colour on FIGHT. Nobody takes damage during those 3.5 seconds.
- **Quick chat:** eight emotes (GG, Nice shot!, Revenge incoming…) on keys 1–8, T for the wheel, or the chat button on phones. They show as bubbles over your plane; AI pilots use them too. One every 1.5 seconds.
- **Kill streaks** get a callout at each tier (Double kill, Triple kill, Rampage, Unstoppable, Legendary, Godlike, Ace of aces, then Warlord, Apex predator, Immortal, Mythic, Sky god and Absolute legend at 50) with its own sound, plus a small meter showing how close the next tier is.
- **Arena today** can be ranked by total kills or by best single-round score. A pilot's round is saved when the round ends or when they leave mid-round.
- **Dropped connections reconnect.** If a pilot's connection drops, the arena holds their seat, score and streak for 30 seconds while the game reconnects them. Leaving on purpose frees the seat right away. A hidden tab sends a heartbeat so it isn't dropped as idle; pilots who go quiet for 45 seconds are removed. If the server restarts (every deploy restarts it), players are reconnected to a fresh round.
- **A boss** enters each round 35 seconds in, then about every 70 seconds. Each theater has its own: a **Zeppelin** (WW1), a **Destroyer** (Pacific), a **Strategic bomber** (Modern), a **Dreadnought** (Space) and a **Sentinel** (Neon). It has 70 to 110 hull and its turrets fire back at the nearest pilot, so it takes several pilots or a long fight. Rolling dodges its fire. The pilot who finishes it gets +300 points and it drops Overdrive, a weapon and a random power-up.
- **AI pilots** (marked "AI" on the scoreboard) top a public arena up to 8 pilots. They leave as real people arrive. Each has a temperament (hunter, vengeful, opportunist, brawler) and a skill level. They pick targets by threat and opportunity, lead their shots, dodge-roll missiles and pilots on their tail, weave under fire, go for repairs when hurt, pick up power-ups they fly through, and use rail guns, missiles and mines.
- **Custom rules for private arenas:** 2 to 15 pilots, round length (2–8 minutes), bosses off, normal or fast, and which power-ups are in play.
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
