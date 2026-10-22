#!/bin/sh
# Builds index.html (standalone site page) from game.html (the artifact body).
set -e
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  sed -n '1,/^<\/style>/p' game.html | sed 's#<title>Super Sortie</title>#<title>Super Sortie: The Daily Dogfight Game</title>#'
  cat <<'HEAD'
<meta name="description" content="A new five-wave dogfight every day. Same sky for every pilot. Fly it, share your tiles, climb the global leaderboard.">
<meta property="og:title" content="Super Sortie">
<meta property="og:description" content="A new five-wave dogfight every day. Same sky for every pilot on Earth.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Super Sortie">
<meta property="og:url" content="https://supersortie.io/">
<meta property="og:image" content="https://supersortie.io/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Super Sortie: a top-down dogfight over a tropical island">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Super Sortie">
<meta name="twitter:description" content="A new five-wave dogfight every day. Same sky for every pilot on Earth.">
<meta name="twitter:image" content="https://supersortie.io/og.png">
<link rel="canonical" href="https://supersortie.io/">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23090c14'/%3E%3Cpath fill='%23ff8a3d' d='M16 3l2.2 6.8v3.8l10 5.7v2.4l-10-2.8-.5 5.6 3.3 2.5v1.8l-5-1.4-5 1.4v-1.8l3.3-2.5-.5-5.6-10 2.8v-2.4l10-5.7V9.8z'/%3E%3C/svg%3E">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon-180.png">
<meta name="theme-color" content="#090c14">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Super Sortie">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script src="config.js"></script>
HEAD
  printf '</head>\n<body>\n'
  sed -n '/^<\/style>/,$p' game.html | tail -n +2
  printf '</body>\n</html>\n'
} > public/index.html
echo "built public/index.html"
