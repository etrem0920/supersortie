// Super Sortie leaderboard API: Cloudflare Worker + D1.
//
//   POST   /api/v1/scores                 submit today's daily result (one per device per day)
//   GET    /api/v1/leaderboard?day=N      top scores, totals, and the caller's own rank
//   DELETE /api/v1/admin/scores?day=N&deviceId=…   hide a cheated score (Bearer ADMIN_TOKEN)
//   GET    /api/v1/health
//   GET    /api/v1/rooms/CODE/ws[?create=1]   co-op room WebSocket (see coop.js)
//   GET    /api/v1/arena/ws?quick=1            join the fullest public arena with room (see arena.js)
//   GET    /api/v1/arena/ws?code=CODE[&create=1&theme=ww2&bots=1]   private arena
//   GET    /api/v1/arena/online                pilots in public arenas right now
//   GET    /api/v1/arena/list                  public arenas with people in them (server browser)
//   GET    /api/v1/league?deviceId=…           this week's league group (see league.js)
//   GET    /api/v1/arena/leaderboard?deviceId=…   today's top arena pilots by kills
//   /api/v1/auth/*, /api/v1/me*, /api/v1/pilots/NAME   pilot accounts, friends and profiles (see accounts.js)

import { CoopRoom, ROOM_ALPHABET } from './coop.js';
import { ArenaRoom, ArenaDirectory } from './arena.js';
import { serverDay, clientDay } from './day.js';
import { handleAccounts, accountFor } from './accounts.js';
import { joinLeague, leagueView } from './league.js';
import { postGhost, listGhosts, getGhost } from './ghosts.js';
import { postFeedback, listFeedback } from './feedback.js';
export { CoopRoom, ArenaRoom, ArenaDirectory };

const THEMES = new Set(['ww1', 'ww2', 'modern', 'space', 'neon']);
const MODS = new Set(['standard', 'glass', 'swarm', 'ironace', 'overcast', 'crosswind', 'hotguns']);
const PLANES = new Set(['camel', 'dr1', 'spad', 'albatros', 'nieuport', 'bristol', 'hellcat', 'corsair', 'p38', 'spitfire', 'mustang', 'fw190', 'f16', 'f18', 'f15', 'halberd', 'specter', 'nightjar', 'lancer', 'wraith', 'bulwark', 'striker', 'nomad', 'harbinger', 'vector', 'overdrive', 'pulse', 'glide', 'prism', 'razor', 'fokker7', 'se5a', 'snipe', 'p47', 'bf109', 'zero', 'raptor', 'yf23', 'su57', 'valkyrie', 'manta', 'talon', 'outrun', 'laserwing', 'hexa', 'eindecker', 'dolphin', 'ssw', 'me262', 'ho229', 'p82', 'sr71', 'su47', 'f117', 'seraph', 'leviathan', 'nova', 'synth', 'glitch', 'arcadex', 'junkers', 'do335', 'darkstar', 'dreadwing', 'phoenix']);
const BLOCKED = /(fuck|shit|cunt|nigg|fag|bitch|rape|nazi|hitler|kike|retard|whore|slut)/i;
const MAX_PER_IP_PER_DAY = 30;
const TOP_CACHE_SECONDS = 20;

export { serverDay };

export function cleanName(s) {
  s = String(s || '').replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!s || BLOCKED.test(s.replace(/[^a-z]/gi, ''))) return 'Pilot';
  return s;
}

// Returns { entry } or { error }. Plausibility checks are deliberately loose so honest
// players never get rejected; they stop casual console edits, not determined cheaters.
export function validate(b, now = Date.now()) {
  if (!b || typeof b !== 'object') return { error: 'bad_body' };
  const day = Number(b.day), sd = serverDay(now);
  if (!Number.isInteger(day) || day < sd - 1 || day > sd + 1) return { error: 'day_out_of_range' };
  const deviceId = String(b.deviceId || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(deviceId)) return { error: 'bad_device' };
  const score = Number(b.score), kills = Number(b.kills), hp = Number(b.hp), time = Number(b.time);
  if (!Number.isInteger(score) || score < 0 || score > 60000) return { error: 'bad_score' };
  if (!Number.isInteger(kills) || kills < 0 || kills > 90) return { error: 'bad_kills' };
  if (!Number.isInteger(hp) || hp < 0 || hp > 10) return { error: 'bad_hp' };
  if (!Number.isFinite(time) || time < 8 || time > 3600) return { error: 'bad_time' };
  const grades = String(b.grades || '');
  if (!/^[gyoxn]{5}$/.test(grades)) return { error: 'bad_grades' };
  const theme = String(b.theme || '');
  if (!THEMES.has(theme)) return { error: 'bad_theme' };
  const mod = MODS.has(b.mod) ? b.mod : null;
  const cleared = (grades.match(/[gyo]/g) || []).length;
  if (!/^[gyo]*[xn]*$/.test(grades) || (grades.match(/x/g) || []).length > 1) return { error: 'bad_grades' };
  const waveTimes = Array.isArray(b.waveTimes) ? b.waveTimes.map(Number) : [];
  if (waveTimes.length !== cleared || waveTimes.some(t => !Number.isFinite(t) || t < 2.5 || t > 900)) return { error: 'bad_wave_times' };
  if (waveTimes.reduce((s, t) => s + t, 0) > time + 1) return { error: 'implausible' };
  const won = cleared === 5;
  if (score > 1500 * kills + 25000) return { error: 'implausible' };
  // Hull bonus: 3,000 for a full hull (10 points today, 3 in older clients).
  if (won && score < hp * (hp > 3 ? 300 : 1000)) return { error: 'implausible' };
  const plane = PLANES.has(b.plane) ? b.plane : null;
  const liv = Number(b.livery);
  const livery = Number.isInteger(liv) && liv >= 0 && liv <= 4 ? liv : 0;
  const fav = PLANES.has(b.fav) ? b.fav : plane;
  return { entry: { day, deviceId, name: cleanName(b.name), score, grades, time, theme, hp, kills, mod, waveTimes, plane, livery, fav } };
}

// ALLOWED_ORIGIN is one origin or a comma-separated list, e.g.
// "https://supersortie.io,https://www.supersortie.io". "*" allows any site.
function corsHeaders(env, req) {
  const allowed = String((env && env.ALLOWED_ORIGIN) || '*').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req && req.headers.get('origin');
  const allow = allowed.includes('*') ? '*' : (origin && allowed.includes(origin) ? origin : allowed[0]);
  return {
    'access-control-allow-origin': allow,
    'vary': 'Origin',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  };
}
function json(data, status, headers, extra) {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers, extra || {}) });
}
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function postScore(req, env, cors) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > 4096) return json({ error: 'too_large' }, 413, cors);
  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
  const { entry, error } = validate(body);
  if (error) return json({ error }, 422, cors);

  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const ipHash = (await sha256Hex(`${ip}|${entry.day}|${env.IP_SALT || 'dev-salt'}`)).slice(0, 24);
  await env.DB.prepare('INSERT INTO ip_hits (day, ip_hash, n) VALUES (?, ?, 1) ON CONFLICT(day, ip_hash) DO UPDATE SET n = n + 1').bind(entry.day, ipHash).run();
  const hits = await env.DB.prepare('SELECT n FROM ip_hits WHERE day = ? AND ip_hash = ?').bind(entry.day, ipHash).first();
  if (hits && hits.n > MAX_PER_IP_PER_DAY) return json({ error: 'rate_limited' }, 429, cors);

  // Signed-in pilots get one daily per account too, not just one per device.
  const acct = await accountFor(env, req);
  if (acct && await env.DB.prepare('SELECT 1 FROM scores WHERE day = ? AND account_id = ?').bind(entry.day, acct.id).first()) return json({ error: 'already_submitted' }, 409, cors);
  const res = await env.DB.prepare(
    `INSERT INTO scores (day, device_id, name, score, grades, time_s, theme, hp, kills, mod, wave_times, ip_hash, created_at, plane, livery, fav, account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(day, device_id) DO NOTHING`
  ).bind(entry.day, entry.deviceId, entry.name, entry.score, entry.grades, entry.time, entry.theme, entry.hp, entry.kills, entry.mod, JSON.stringify(entry.waveTimes), ipHash, Date.now(), entry.plane, entry.livery, entry.fav, acct ? acct.id : null).run();
  if (!res.meta || !res.meta.changes) return json({ error: 'already_submitted' }, 409, cors);

  const rank = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ? AND hidden = 0 AND score > ?').bind(entry.day, entry.score).first();
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ? AND hidden = 0').bind(entry.day).first();
  try { await joinLeague(env, entry.deviceId, acct ? acct.id : null, entry.day); } catch (e) { /* leagues are a bonus; never fail a score over them */ }
  return json({ ok: true, rank: rank.n + 1, total: total.n }, 201, cors);
}

async function topList(env, day, limit) {
  const agg = await env.DB.prepare('SELECT COUNT(*) AS n, AVG(score) AS a FROM scores WHERE day = ? AND hidden = 0').bind(day).first();
  const rows = (await env.DB.prepare(
    'SELECT s.device_id, s.name, s.score, s.grades, s.theme, s.time_s, s.plane, s.livery, s.fav, a.username FROM scores s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.day = ? AND s.hidden = 0 ORDER BY s.score DESC, s.time_s ASC, s.created_at ASC LIMIT ?'
  ).bind(day, limit).all()).results || [];
  let prev = null, rank = 0;
  const entries = rows.map((r, i) => { if (r.score !== prev) { rank = i + 1; prev = r.score; } return { rank, name: r.name, score: r.score, grades: r.grades, theme: r.theme, time: r.time_s, plane: r.plane, livery: r.livery, fav: r.fav, u: r.username || undefined, _d: r.device_id }; });
  return { day, total: agg.n, avg: Math.round(agg.a || 0), entries };
}

async function getBoard(url, env, cors, ctx) {
  const day = Number(url.searchParams.get('day')) || serverDay();
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 100));
  const deviceId = String(url.searchParams.get('deviceId') || '');

  // The top list is identical for everyone, so cache it briefly at the edge.
  let top = null;
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(`https://cache.internal/top/${day}/${limit}`);
  if (cache) { const hit = await cache.match(cacheKey); if (hit) top = await hit.json(); }
  if (!top) {
    top = await topList(env, day, limit);
    if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(top), { headers: { 'cache-control': `max-age=${TOP_CACHE_SECONDS}` } })));
  }

  let me = null;
  if (/^[A-Za-z0-9-]{8,64}$/.test(deviceId)) {
    const mine = await env.DB.prepare('SELECT name, score, grades, theme, plane, livery, fav FROM scores WHERE day = ? AND device_id = ? AND hidden = 0').bind(day, deviceId).first();
    if (mine) {
      const above = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ? AND hidden = 0 AND score > ?').bind(day, mine.score).first();
      me = { rank: above.n + 1, score: mine.score, name: mine.name, grades: mine.grades, theme: mine.theme, plane: mine.plane, livery: mine.livery, fav: mine.fav };
    }
  }
  const entries = top.entries.map(e => ({ rank: e.rank, name: e.name, score: e.score, grades: e.grades, theme: e.theme, time: e.time, plane: e.plane, livery: e.livery, fav: e.fav, u: e.u, me: !!deviceId && e._d === deviceId }));
  return json({ day, total: top.total, avg: top.avg, entries, me }, 200, cors, { 'cache-control': 'no-store' });
}

async function adminDelete(url, req, env, cors) {
  const auth = req.headers.get('authorization') || '';
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'unauthorized' }, 401, cors);
  const day = Number(url.searchParams.get('day'));
  const deviceId = url.searchParams.get('deviceId');
  const name = url.searchParams.get('name');
  if (!Number.isInteger(day) || (!deviceId && !name)) return json({ error: 'need_day_and_device_or_name' }, 400, cors);
  const res = deviceId
    ? await env.DB.prepare('UPDATE scores SET hidden = 1 WHERE day = ? AND device_id = ?').bind(day, deviceId).run()
    : await env.DB.prepare('UPDATE scores SET hidden = 1 WHERE day = ? AND name = ?').bind(day, name).run();
  return json({ ok: true, hidden: res.meta.changes }, 200, cors);
}

// Browsers send an Origin header on WebSocket upgrades; only our own sites may open rooms.
function originAllowed(req, env) {
  const allowed = String((env && env.ALLOWED_ORIGIN) || '*').split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin');
  return allowed.includes('*') || !origin || allowed.includes(origin);
}
async function roomSocket(req, env, code) {
  if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
  if (!originAllowed(req, env)) return new Response('Forbidden', { status: 403 });
  if (![...code].every(ch => ROOM_ALPHABET.includes(ch))) return new Response('Bad room code', { status: 400 });
  const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
  return stub.fetch(req);
}

async function arenaSocket(req, env, url) {
  if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
  if (!originAllowed(req, env)) return new Response('Forbidden', { status: 403 });
  let name;
  const pub = String(url.searchParams.get('arena') || '');
  if (/^pub-\d{1,3}$/.test(pub)) {
    name = pub; // reconnecting to a specific public arena
  } else if (url.searchParams.get('quick') === '1') {
    const dir = env.ARENA_DIR.get(env.ARENA_DIR.idFromName('global'));
    name = (await (await dir.fetch('https://dir/assign', { method: 'POST' })).json()).name;
  } else {
    const code = String(url.searchParams.get('code') || '').toUpperCase();
    if (code.length !== 4 || ![...code].every(ch => ROOM_ALPHABET.includes(ch))) return new Response('Bad arena code', { status: 400 });
    name = `prv-${code}`;
  }
  const fwd = new URL(url);
  fwd.searchParams.set('name', name);
  // Only the Worker vouches for the account: the client sends its session token, the room gets the id.
  fwd.searchParams.delete('acct');
  const auth = url.searchParams.get('auth');
  fwd.searchParams.delete('auth');
  const acct = auth ? await accountFor(env, auth) : null;
  if (acct) fwd.searchParams.set('acct', String(acct.id));
  const stub = env.ARENAS.get(env.ARENAS.idFromName(name));
  return stub.fetch(new Request(fwd, req));
}
async function arenaBoard(url, env, cors, req) {
  const day = clientDay(url.searchParams.get('day'));
  const deviceId = String(url.searchParams.get('deviceId') || '');
  const byRound = url.searchParams.get('sort') === 'round';
  const viewer = req ? await accountFor(env, req).catch(() => null) : null;
  // One line per pilot: rows from the same account (any device) are added together.
  const rows = (await env.DB.prepare(
    'SELECT s.device_id, s.name, s.plane, s.livery, s.kills, s.deaths, s.rounds, s.wins, s.best_round, s.best_streak, s.updated_at, s.account_id, a.username FROM arena_scores s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.day = ? AND s.hidden = 0 ORDER BY s.updated_at DESC LIMIT 5000'
  ).bind(day).all()).results || [];
  // A device that signed in today belongs to that account all day; other guests are grouped by callsign.
  const deviceAcct = new Map();
  for (const r of rows) if (r.account_id) deviceAcct.set(r.device_id, r.account_id);
  const byWho = new Map();
  for (const r of rows) {
    const acct = r.account_id || deviceAcct.get(r.device_id);
    const who = acct ? 'a' + acct : 'n' + String(r.name || '').trim().toLowerCase();
    let e = byWho.get(who);
    if (!e) { e = { name: r.username || r.name, plane: r.plane, livery: r.livery, kills: 0, deaths: 0, rounds: 0, wins: 0, best: 0, streak: 0, first: r.updated_at, u: r.username || undefined, me: false }; byWho.set(who, e); }
    e.kills += r.kills; e.deaths += r.deaths; e.rounds += r.rounds; e.wins += r.wins;
    e.best = Math.max(e.best, r.best_round); e.streak = Math.max(e.streak, r.best_streak); e.first = Math.min(e.first, r.updated_at);
    if ((deviceId && r.device_id === deviceId) || (viewer && r.account_id === viewer.id)) e.me = true;
  }
  const all = [...byWho.values()].sort(byRound ? (a, b) => b.best - a.best || b.kills - a.kills || a.first - b.first : (a, b) => b.kills - a.kills || b.best - a.best || a.first - b.first);
  all.forEach((e, i) => { e.rank = i + 1; delete e.first; });
  const entries = all.slice(0, 50), mine = all.find(e => e.me);
  return json({ day, total: all.length, entries, me: mine && !entries.includes(mine) ? mine : null }, 200, cors, { 'cache-control': 'no-store' });
}
// Server browser: public arenas with people in them right now, busiest first.
async function arenaList(env, cors) {
  const dir = env.ARENA_DIR.get(env.ARENA_DIR.idFromName('global'));
  const list = await (await dir.fetch('https://dir/list')).json();
  const now = Date.now();
  const arenas = Object.entries(list)
    .filter(([, e]) => now - e.t < 90000 && e.h > 0)
    .map(([name, e]) => ({ name, n: Number(name.slice(4)), humans: e.h, bots: e.bots || 0, theme: e.theme || null, round: e.round || 1, phase: e.phase || 'play', left: Math.max(0, (e.ends || 0) - now), names: e.names || [] }))
    .sort((a, b) => b.humans - a.humans || a.n - b.n)
    .slice(0, 30);
  return json({ arenas, max: 12 }, 200, cors, { 'cache-control': 'no-store' });
}
async function arenaOnline(env, cors) {
  const dir = env.ARENA_DIR.get(env.ARENA_DIR.idFromName('global'));
  const list = await (await dir.fetch('https://dir/list')).json();
  const now = Date.now();
  const live = Object.values(list).filter(e => now - e.t < 90000 && e.h > 0);
  return json({ pilots: live.reduce((n, e) => n + e.h, 0), arenas: live.length }, 200, cors, { 'cache-control': 'max-age=10' });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/api/v1/scores' && req.method === 'POST') return await postScore(req, env, cors);
      if (url.pathname === '/api/v1/leaderboard' && req.method === 'GET') return await getBoard(url, env, cors, ctx);
      if (url.pathname === '/api/v1/admin/scores' && req.method === 'DELETE') return await adminDelete(url, req, env, cors);
      if (url.pathname === '/api/v1/health') return json({ ok: true, day: serverDay() }, 200, cors);
      const room = url.pathname.match(/^\/api\/v1\/rooms\/([A-Z0-9]{4})\/ws$/);
      if (room) return await roomSocket(req, env, room[1]);
      if (url.pathname === '/api/v1/arena/ws') return await arenaSocket(req, env, url);
      if (url.pathname === '/api/v1/arena/online' && req.method === 'GET') return await arenaOnline(env, cors);
      if (url.pathname === '/api/v1/arena/list' && req.method === 'GET') return await arenaList(env, cors);
      if (url.pathname === '/api/v1/league' && req.method === 'GET') {
        const deviceId = String(url.searchParams.get('deviceId') || '');
        if (!/^[A-Za-z0-9-]{8,64}$/.test(deviceId)) return json({ error: 'bad_device' }, 400, cors);
        return json(await leagueView(env, deviceId), 200, cors, { 'cache-control': 'no-store' });
      }
      if (url.pathname === '/api/v1/arena/leaderboard' && req.method === 'GET') return await arenaBoard(url, env, cors, req);
      if (url.pathname === '/api/v1/feedback' && req.method === 'POST') { const who = await accountFor(env, req); return await postFeedback(req, env, json, cors, who && who.username); }
      if (url.pathname === '/api/v1/admin/feedback' && req.method === 'GET') return await listFeedback(url, req, env, json, cors);
      if (url.pathname === '/api/v1/ghost' && req.method === 'POST') return await postGhost(req, env, json, cors);
      if (url.pathname === '/api/v1/ghost' && req.method === 'GET') return await getGhost(url, env, json, cors);
      if (url.pathname === '/api/v1/ghosts' && req.method === 'GET') return await listGhosts(url, env, json, cors);
      const acct = await handleAccounts(req, env, url, cors);
      if (acct) return acct;
      return json({ error: 'not_found' }, 404, cors);
    } catch (e) {
      return json({ error: 'server_error' }, 500, cors);
    }
  },
};
