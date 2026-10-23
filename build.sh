#!/bin/sh
# Builds index.html (standalone site page) from game.html (the artifact body).
set -e
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  sed -n '1,/^<\/style>/p' game.html | sed 's#<title>Super Sortie</title>#<title>Super Sortie: The Daily Dogfight Game</title>#'
  cat <<'HEAD'
<meta name="description" content="A new five-wave dogfight every day, and everyone flies the same one. Play free in your browser and see where you land on the leaderboard.">
<meta property="og:title" content="Super Sortie">
<meta property="og:description" content="A new dogfight every day, and everyone gets the same one. You get one try to top the board.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Super Sortie">
<meta property="og:url" content="https://supersortie.io/">
<meta property="og:image" content="https://supersortie.io/og.png?v=2">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Super Sortie: a new dogfight every day, shown as a week of sorties across five eras with today highlighted">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Super Sortie">
<meta name="twitter:description" content="A new dogfight every day, and everyone gets the same one. You get one try to top the board.">
<meta name="twitter:image" content="https://supersortie.io/og.png?v=2">
<link rel="canonical" href="https://supersortie.io/">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png">
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">
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
