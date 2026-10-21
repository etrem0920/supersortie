# Super Sortie — first short (22.8 s, 1080×1920)

## YouTube Shorts
**Title:** Everyone on Earth gets the same dogfight today ✈️ #shorts
**Description:**
A new 5-wave dogfight every day, the same for every pilot. Pick your war (1917, 1944, 2026, 2389 or 1986), beat the ace, climb today's leaderboard. Squad up in 4-player co-op or fly forever in zen mode.
Free, in your browser: https://supersortie.io
#shorts #indiegame #browsergame #dailygame #dogfight #gaming

## TikTok
Same dogfight for everyone on Earth today. Can you beat the ace? ✈️ supersortie.io (link in bio)
#indiegame #gaming #browsergame #dailychallenge #planes #fyp

## Instagram Reels
Everyone on Earth gets the same dogfight today. 5 waves, 1 ace, 1 leaderboard. Free in your browser at supersortie.io (link in bio) ✈️
#indiegame #gamedev #browsergame #dailygame #dogfight #aviation #retrogaming

## Posting tips
- Use `super-sortie-short.mp4` (has its own soundtrack). If you'd rather use a trending sound in the app, upload `super-sortie-short-no-music.mp4` and pick the sound there. Trending sounds usually get more reach on TikTok and Reels.
- Cover image: `cover.jpg` (the end card), or pick a frame in the app.
- Put https://supersortie.io in the bio on all three. TikTok and Instagram don't make links in captions clickable.
- Post the same video on all three on the same day, then post again daily: today's ace, a close call, a co-op wipe. Daily posts fit a daily game.

## Remaking the video
With the site served locally (`python3 -m http.server 8811 -d public`):
`node promo/capture.js <out-dir>` captures the frames, `python3 promo/music.py <out-dir>` builds the soundtrack, and ffmpeg joins them:
`ffmpeg -framerate 30 -i <out-dir>/frames/%05d.jpg -i <out-dir>/music.wav -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart promo/super-sortie-short.mp4`
