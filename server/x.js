// Posts to the game's X account three times a day, through X's official API (POST /2/tweets).
//   06:07 UTC  last night's results, and today's sortie is live
//   14:07 UTC  today's sortie: the ace, the rules
//   22:07 UTC  today's leaderboard so far
// Each post is built from the real day: the seeded ace and rules, the daily board, the arena board.
// Needs four secrets from the X developer portal (an app with Read and Write permission):
//   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
// and X_POSTING = "on". Anything else and it only composes, never posts.
// X charges far more for a post with a link in it, so only the slots in X_LINK_SLOTS (default
// "live") carry supersortie.io. The others point to the link in the profile instead.
import { serverDay, EPOCH_UTC } from './day.js';

export const SITE = 'supersortie.io';

// Same seeding as the game, so the ace and rules named here are the ones pilots fly against.
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function mulberry32(a) {
  return () => { let t = (a += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const MODS = [
  ['standard', 'Standard rules', 'Normal rules. Nothing special today.'],
  ['glass', 'Glass cannon', 'Six hull instead of ten, but your guns hit twice as hard.'],
  ['swarm', 'Swarm', 'Every wave brings two extra scouts.'],
  ['ironace', 'Iron ace', 'The ace has 50% more armor and an extra wingman.'],
  ['overcast', 'Overcast', 'Low cloud. Enemies can hide above the deck.'],
  ['crosswind', 'Crosswind', 'A strong wind pushes everything sideways.'],
  ['hotguns', 'Hot guns', 'Everyone fires 30% faster, enemies too.'],
];
const ACE_NAMES = ['Red Kestrel', 'Black Viper', 'Iron Heron', 'Crimson Lynx', 'Silver Wolf', 'Storm Petrel', 'Night Hawk', 'Scarlet Fox', 'Baron Grey', 'Golden Shrike', 'The Widow', 'Cold Harbor'];
export function dailyInfo(day) {
  const d = new Date(EPOCH_UTC + (day - 1) * 86400000);
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const r = mulberry32(xmur3(`DD3-${key}`)());
  const [modId, modName, modDesc] = MODS[Math.floor(r() * MODS.length)];
  r(); // wind direction
  return { day, modId, modName, modDesc, ace: ACE_NAMES[Math.floor(r() * ACE_NAMES.length)] };
}

const TILE = { g: '🟩', y: '🟨', o: '🟧', x: '🟥', n: '⬛' };
const tiles = g => [...String(g || '').slice(0, 5)].map(c => TILE[c] || '⬛').join('');
const fmt = n => Math.round(n).toLocaleString('en-US');
const ERA = { ww1: 'WWI', ww2: 'WWII', modern: 'modern jets', space: 'orbit', neon: 'neon' };

// Only registered usernames get named in public. Guest callsigns are free text.
async function dayStats(env, day) {
  const agg = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ? AND hidden = 0').bind(day).first();
  const top = await env.DB.prepare('SELECT s.score, s.grades, s.theme, a.username FROM scores s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.day = ? AND s.hidden = 0 ORDER BY s.score DESC LIMIT 1').bind(day).first();
  const arena = await env.DB.prepare('SELECT a.username, SUM(s.kills) AS kills FROM arena_scores s JOIN accounts a ON a.id = s.account_id WHERE s.day = ? AND s.hidden = 0 GROUP BY s.account_id ORDER BY kills DESC LIMIT 1').bind(day).first().catch(() => null);
  return { pilots: (agg && agg.n) || 0, top, arena: arena && arena.kills > 0 ? arena : null };
}

// Rotating lines so no two posts in a row read the same (X refuses exact duplicates anyway).
const SPOTLIGHT = [
  'Five waves, one enemy ace, one try. Everyone flies the same sky.',
  'WWI biplanes to neon starfighters. Pick your era, the sky stays the same for everyone.',
  'Arena is open all day: free-for-all dogfights with power-ups and bosses.',
  'Bring a friend: co-op sorties with a room code, no download.',
  'Crates are cosmetic only. Skins, contrails, tracers and kill effects. Never pay-to-win.',
  'Weekly leagues: climb the ladder by flying the daily.',
  'Race the ghosts of today\'s best runs.',
  'Free, in your browser, on phone or desktop.',
];
const TAGS = ['#indiegame', '#browsergame', '#gamedev', '#indiedev', '#retrogaming', '#webgame'];
const pick = (arr, n) => arr[((n % arr.length) + arr.length) % arr.length];

export function slotFor(now = Date.now()) {
  const h = new Date(now).getUTCHours();
  return h < 10 ? 'recap' : h < 18 ? 'live' : 'board';
}

export async function composePost(env, slot, now = Date.now()) {
  const day = serverDay(now), info = dailyInfo(day), seq = day * 3 + ['recap', 'live', 'board'].indexOf(slot);
  const tag = pick(TAGS, day + seq), spot = pick(SPOTLIGHT, seq);
  let text;
  if (slot === 'recap') {
    const y = await dayStats(env, day - 1);
    const lines = [`Sortie #${day - 1} is in the books.`];
    if (y.pilots) lines.push(`${fmt(y.pilots)} pilot${y.pilots === 1 ? '' : 's'} flew it.`);
    if (y.top && y.top.username) lines.push(`Top pilot: ${y.top.username} with ${fmt(y.top.score)} ${tiles(y.top.grades)}`);
    else if (y.top) lines.push(`Top score: ${fmt(y.top.score)} ${tiles(y.top.grades)}`);
    if (y.arena) lines.push(`Arena ace: ${y.arena.username}, ${fmt(y.arena.kills)} kills.`);
    lines.push('', `Sortie #${day} is live now. Ace: ${info.ace}.`, `${SITE} ${tag}`);
    text = lines.join('\n');
  } else if (slot === 'live') {
    text = [`✈️ Sortie #${day}`, '', `Enemy ace: ${info.ace}`, `Rules: ${info.modName}. ${info.modDesc}`, '', spot, `${SITE} ${tag}`].join('\n');
  } else {
    const t = await dayStats(env, day);
    if (t.top && t.pilots >= 2) {
      const who = t.top.username ? `${t.top.username} leads` : 'The lead is';
      text = [`Sortie #${day} so far: ${fmt(t.pilots)} pilots in the air.`, '', `${who} with ${fmt(t.top.score)} ${tiles(t.top.grades)}${ERA[t.top.theme] ? ` flying ${ERA[t.top.theme]}` : ''}.`, `${info.ace} is still out there. Think you can beat it?`, '', `${SITE} ${tag}`].join('\n');
    } else text = [`${info.ace} is waiting in wave 5 of Sortie #${day}.`, '', spot, '', `One dogfight a day. ${SITE} ${tag}`].join('\n');
  }
  const linkSlots = String(env.X_LINK_SLOTS || 'live').split(',').map(x => x.trim());
  if (!linkSlots.includes(slot)) text = text.replace(/^One dogfight a day\. supersortie\.io/m, 'One dogfight a day. Link in bio.').replace(/supersortie\.io ?/g, 'Free to play, link in bio. ');
  return { day, slot, text: fitPost(text) };
}

// X counts every URL as 23 characters and most emoji as 2. Keep a margin under 280.
export function postLength(text) {
  return [...text.replace(/\S+\.(io|com|dev)\S*/g, 'x'.repeat(23))].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2000 ? 2 : 1), 0);
}
function fitPost(text) {
  let t = text;
  if (postLength(t) > 270) t = t.replace(/ #\w+$/, '');
  while (postLength(t) > 270 && t.includes('\n\n')) t = t.replace('\n\n', '\n');
  return t;
}

// OAuth 1.0a user-context signing, which is what POST /2/tweets takes for posting as an account.
const pct = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
async function oauthHeader(env, method, url) {
  const o = {
    oauth_consumer_key: env.X_API_KEY, oauth_nonce: crypto.randomUUID().replace(/-/g, ''), oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_token: env.X_ACCESS_TOKEN, oauth_version: '1.0',
  };
  const params = Object.keys(o).sort().map(k => `${pct(k)}=${pct(o[k])}`).join('&');
  const base = [method, pct(url), pct(params)].join('&');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${pct(env.X_API_SECRET)}&${pct(env.X_ACCESS_SECRET)}`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base)))));
  o.oauth_signature = sig;
  return 'OAuth ' + Object.keys(o).sort().map(k => `${pct(k)}="${pct(o[k])}"`).join(', ');
}

export const xReady = env => env.X_POSTING === 'on' && !!(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET);

export async function sendPost(env, text, fetcher = fetch) {
  const url = 'https://api.twitter.com/2/tweets';
  const r = await fetcher(url, { method: 'POST', headers: { authorization: await oauthHeader(env, 'POST', url), 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, id: body.data && body.data.id, error: r.ok ? null : JSON.stringify(body).slice(0, 300) };
}

// The cron handler. One post per slot per day, even if Cloudflare retries.
export async function runScheduledPost(env, now = Date.now(), fetcher = fetch) {
  const slot = slotFor(now), post = await composePost(env, slot, now), key = `${post.day}-${slot}`;
  const done = await env.DB.prepare('SELECT status FROM x_posts WHERE slot_key = ?').bind(key).first();
  if (done && done.status === 'posted') return { skipped: 'already posted', key };
  if (!xReady(env)) {
    await env.DB.prepare('INSERT OR REPLACE INTO x_posts (slot_key, text, status, tweet_id, error, created_at) VALUES (?, ?, ?, NULL, NULL, ?)').bind(key, post.text, 'draft', now).run();
    return { draft: true, key, text: post.text };
  }
  const res = await sendPost(env, post.text, fetcher);
  await env.DB.prepare('INSERT OR REPLACE INTO x_posts (slot_key, text, status, tweet_id, error, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(key, post.text, res.ok ? 'posted' : 'failed', res.id || null, res.error, now).run();
  return { key, ...res, text: post.text };
}
