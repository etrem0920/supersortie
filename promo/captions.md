# Super Sortie shorts: captions and schedule

All videos are 1080×1920, 30 fps, and safe for YouTube Shorts, TikTok and Instagram Reels. Each one comes in two versions: `<name>.mp4` has its own soundtrack, and `<name>-no-music.mp4` is for adding a trending sound inside the app (this usually gets more reach on TikTok and Reels). The covers are `cover-<name>.jpg`.

Put **https://supersortie.io** in the bio on every platform, because caption links aren't clickable on TikTok or Instagram.

## Posting schedule

Post one video every other day, on all three platforms on the same day. Around 6–9 pm local time works well. Then repeat the best performer in week 2 with a new hook line.

| Day | Video | Why this order |
| --- | --- | --- |
| 1 | `super-sortie-short` (Same dogfight) | Explains the whole idea |
| 3 | `03-the-ace` | The strongest hook. Story and payoff |
| 5 | `02-pick-your-war` | Shows the variety. Gets "which one are you?" comments |
| 7 | `04-squad-up` | Gets people sharing it with friends |
| 9 | `05-zen` | A change of pace that reaches a calmer audience |

---

## 1. Same dogfight (`super-sortie-short.mp4`, 23 s)

**YouTube title:** Everyone on Earth gets the same dogfight today ✈️ #shorts
**YouTube description:** A new 5-wave dogfight every day, the same for every pilot. Pick your war, beat the ace, climb today's leaderboard. Free in your browser: https://supersortie.io
#shorts #indiegame #browsergame #dailygame #dogfight

**TikTok:** Same dogfight for everyone on Earth today. Can you beat the ace? ✈️ link in bio
#indiegame #gaming #browsergame #dailychallenge #planes #fyp

**Instagram:** Everyone on Earth gets the same dogfight today. 5 waves, 1 ace, 1 leaderboard. Free at supersortie.io (link in bio) ✈️
#indiegame #gamedev #browsergame #dailygame #dogfight #aviation

---

## 2. Pick your war (`02-pick-your-war.mp4`, 23 s)

**YouTube title:** 5 wars. 15 planes. Which one are you flying? ✈️ #shorts
**YouTube description:** 1917 biplanes, 1944 carrier fighters, modern jets, starfighters, and a synthwave arcade. Every theater gets the same daily dogfight. Free in your browser: https://supersortie.io
#shorts #indiegame #ww1 #ww2 #aviation #browsergame

**TikTok:** Pick one: Fokker Dr.I or P-38 Lightning? 👇 New dogfight every day, link in bio
#aviation #ww2 #ww1 #planes #indiegame #gaming #fyp

**Instagram:** Which war are you flying today? 1917, 1944, 2026, 2389 or 1986 👇 Free at supersortie.io (link in bio)
#aviation #ww2planes #warbirds #indiegame #browsergame #pixelart

*Pinned comment idea:* "Drop your plane below. Most-picked plane gets tomorrow's video."

---

## 3. The ace (`03-the-ace.mp4`, 15 s)

**YouTube title:** He has 70 armor. You have 3. ✈️ #shorts
**YouTube description:** Wave 5 of today's sortie: the enemy ace. Roll out of his missile lock and stay on his tail. A new ace every day at https://supersortie.io
#shorts #indiegame #bossfight #dogfight #browsergame

**TikTok:** He has 70 armor. I have 3. 😤 New ace every day, link in bio
#bossfight #indiegame #gaming #dogfight #planes #fyp

**Instagram:** 70 armor vs 3. Today's ace went down, and tomorrow there's a new one. Free at supersortie.io (link in bio) ✈️
#indiegame #gaming #bossfight #aviation #browsergame

*Pinned comment idea:* "What's your best time on today's ace?"

---

## 4. Squad up (`04-squad-up.mp4`, 19 s)

**YouTube title:** 4-player co-op dogfights in your browser ✈️ #shorts
**YouTube description:** Make a room, send the code, fly with up to three friends. Crash, and you're back next wave. The host picks the theater, waves and difficulty. Free, no download: https://supersortie.io
#shorts #coopgames #indiegame #browsergame #gamingwithfriends

**TikTok:** Tag the 3 friends you're flying with ✈️ free co-op, no download, link in bio
#coopgames #gamingwithfriends #indiegame #browsergame #fyp

**Instagram:** Tag your wingmen 👇 4-player co-op dogfights, free in your browser at supersortie.io (link in bio)
#coop #gamingwithfriends #indiegame #browsergame #aviation

---

## 5. Zen (`05-zen.mp4`, 18 s)

**YouTube title:** No timer. No walls. Just you and the sky. ✈️ #shorts
**YouTube description:** Zen mode in Super Sortie: endless flight with a gentle stream of planes, across five theaters. Free in your browser: https://supersortie.io
#shorts #cozygames #relaxing #indiegame #browsergame

**TikTok:** my 5 minute break between meetings ✈️ zen mode, link in bio
#cozygames #relaxinggames #indiegame #chillvibes #fyp

**Instagram:** No timer. No walls. No pressure. Zen mode is free at supersortie.io (link in bio) ✈️
#cozygames #relaxing #indiegame #synthwave #aviation

---

## Remaking or making new videos

Each video is a config file in `promo/videos/` listing its clips, captions, end card and music style (`drive`, `epic` or `chill`). With the site served locally (`python3 -m http.server 8811 -d public`):

```
node promo/capture.js <out-dir> promo/videos/03-the-ace.json
python3 promo/music.py <out-dir>
ffmpeg -framerate 30 -i <out-dir>/frames/%05d.jpg -i <out-dir>/music.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart promo/03-the-ace.mp4
```
