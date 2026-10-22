// Pilot accounts: a username and a password, nothing else (no email, no personal data).
// An account keeps a pilot's progress in sync across devices, gives them a public profile
// that others can open from the leaderboards, and holds their friends list.
//
//   POST   /api/v1/auth/register   {username, password}       -> {token, username}
//   POST   /api/v1/auth/login      {username, password}       -> {token, username, profile}
//   POST   /api/v1/auth/logout     (Bearer)
//   GET    /api/v1/me              (Bearer)                   -> {username, profile}
//   PUT    /api/v1/me/profile      (Bearer) {profile}
//   GET    /api/v1/me/friends      (Bearer)                   -> {friends: [...]}
//   POST   /api/v1/me/friends      (Bearer) {username}
//   DELETE /api/v1/me/friends/NAME (Bearer)
//   POST   /api/v1/me/password    (Bearer) {old, password}   change password (ends other sessions)
//   POST   /api/v1/me/logout-all  (Bearer)                   sign out on every device
//   DELETE /api/v1/me             (Bearer) {password}        delete the account for good
//   GET    /api/v1/pilots/NAME                                -> public profile

import { serverDay } from './day.js';

const PBKDF2_ITERATIONS = 10000; // kept modest for the Workers free plan's CPU limit
const AUTH_PER_HOUR = 30;        // sign-up and log-in attempts per IP per hour
const MAX_PROFILE = 24000;       // bytes
const MAX_FRIENDS = 100;
const BLOCKED = /(fuck|shit|cunt|nigg|fag|bitch|rape|nazi|hitler|kike|retard|whore|slut)/i;

export const validUsername = u => typeof u === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(u) && !BLOCKED.test(u.replace(/[^a-z]/gi, ''));
const validPassword = p => typeof p === 'string' && p.length >= 6 && p.length <= 100;

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, key, 256));
}
function sameString(a, b) { // constant-time compare
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Only the fields the game shows or syncs, each with a sane type and size.
export function cleanProfile(p) {
  p = p && typeof p === 'object' ? p : {};
  const int = (v, max) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0; };
  const str = (v, max) => String(v == null ? '' : v).replace(/[^\w .\-'·]/g, '').slice(0, max);
  const out = {
    xp: int(p.xp, 1e9), title: int(p.title, 50), trail: int(p.trail, 50),
    fav: str(p.fav, 16), favLiv: int(p.favLiv, 30), pic: String(p.pic || '').replace(/[^a-z0-9:#]/gi, '').slice(0, 24), streak: int(p.streak, 1e5), maxStreak: int(p.maxStreak, 1e5), lastDay: int(p.lastDay, 1e6),
    played: int(p.played, 1e6), best: int(p.best, 1e6),
    medals: Array.isArray(p.medals) ? p.medals.slice(0, 40).map(m => str(m, 16)).filter(Boolean) : [],
    aces: {}, arena: {}, zenBest: null, planeUse: {}, liveries: {}, planes: {},
    credits: int(p.credits, 1e9), bullet: int(p.bullet, 20), egg: int(p.egg, 1),
    inv: Array.isArray(p.inv) ? [...new Set(p.inv.slice(0, 600).map(x => String(x)).filter(x => /^[spbt]:[a-z0-9:]{1,24}$/.test(x)))] : [],
  };
  if (p.aces && typeof p.aces === 'object') for (const [d, n] of Object.entries(p.aces).slice(-400)) if (/^\d{1,5}$/.test(d)) out.aces[d] = str(n, 24);
  if (p.arena && typeof p.arena === 'object') for (const k of ['rounds', 'wins', 'kills', 'deaths', 'best', 'top']) out.arena[k] = int(p.arena[k], 1e7);
  if (p.zenBest && typeof p.zenBest === 'object') out.zenBest = { score: int(p.zenBest.score, 1e8), kills: int(p.zenBest.kills, 1e6), time: int(p.zenBest.time, 1e7) };
  for (const key of ['planeUse', 'liveries', 'planes']) if (p[key] && typeof p[key] === 'object') for (const [k, v] of Object.entries(p[key]).slice(0, 60)) out[key][str(k, 16)] = int(v, 1e6);
  return out;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, cors) });
}
async function readBody(req) {
  if (Number(req.headers.get('content-length') || 0) > MAX_PROFILE + 2000) return null;
  try { return await req.json(); } catch (e) { return null; }
}
async function rateLimited(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown', hour = Math.floor(Date.now() / 3600000);
  const ipHash = (await sha256(`${ip}|auth|${hour}|${env.IP_SALT || 'dev-salt'}`)).slice(0, 24);
  await env.DB.prepare('INSERT INTO auth_hits (hour, ip_hash, n) VALUES (?, ?, 1) ON CONFLICT(hour, ip_hash) DO UPDATE SET n = n + 1').bind(hour, ipHash).run();
  const row = await env.DB.prepare('SELECT n FROM auth_hits WHERE hour = ? AND ip_hash = ?').bind(hour, ipHash).first();
  return row && row.n > AUTH_PER_HOUR;
}
async function newSession(env, accountId) {
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, account_id, created_at) VALUES (?, ?, ?)').bind(await sha256(token), accountId, Date.now()).run();
  return token;
}
// Returns {id, username} for a valid "Authorization: Bearer <token>" (or a raw token), else null.
export async function accountFor(env, reqOrToken) {
  const token = typeof reqOrToken === 'string' ? reqOrToken : ((reqOrToken.headers.get('authorization') || '').match(/^Bearer ([a-f0-9]{64})$/) || [])[1];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return await env.DB.prepare('SELECT a.id AS id, a.username AS username FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?').bind(await sha256(token)).first();
}

async function register(req, env, cors) {
  if (await rateLimited(req, env)) return json({ error: 'rate_limited' }, 429, cors);
  const b = await readBody(req);
  if (!b || !validUsername(b.username)) return json({ error: 'bad_username' }, 422, cors);
  if (!validPassword(b.password)) return json({ error: 'bad_password' }, 422, cors);
  const taken = await env.DB.prepare('SELECT 1 FROM accounts WHERE username = ? COLLATE NOCASE').bind(b.username).first();
  if (taken) return json({ error: 'taken' }, 409, cors);
  const salt = randomHex(16), now = Date.now();
  const profile = JSON.stringify(cleanProfile(b.profile));
  const res = await env.DB.prepare('INSERT INTO accounts (username, pass_hash, salt, created_at, updated_at, profile) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(b.username, await hashPassword(b.password, salt), salt, now, now, profile).run();
  const id = res.meta.last_row_id;
  return json({ token: await newSession(env, id), username: b.username }, 201, cors);
}

async function login(req, env, cors) {
  if (await rateLimited(req, env)) return json({ error: 'rate_limited' }, 429, cors);
  const b = await readBody(req);
  if (!b || typeof b.username !== 'string' || typeof b.password !== 'string') return json({ error: 'bad_login' }, 401, cors);
  const a = await env.DB.prepare('SELECT id, username, pass_hash, salt, profile FROM accounts WHERE username = ? COLLATE NOCASE').bind(b.username).first();
  if (!a || !sameString(await hashPassword(b.password, a.salt), a.pass_hash)) return json({ error: 'bad_login' }, 401, cors);
  return json({ token: await newSession(env, a.id), username: a.username, profile: JSON.parse(a.profile || '{}') }, 200, cors);
}

async function publicProfile(env, row, viewer) {
  const day = serverDay();
  const today = await env.DB.prepare('SELECT score, grades, theme, plane FROM scores WHERE day = ? AND account_id = ? AND hidden = 0 ORDER BY score DESC LIMIT 1').bind(day, row.id).first();
  let rank = null;
  if (today) { const above = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE day = ? AND hidden = 0 AND score > ?').bind(day, today.score).first(); rank = above.n + 1; }
  const arena = await env.DB.prepare('SELECT kills, deaths, rounds, wins FROM arena_scores WHERE day = ? AND account_id = ? AND hidden = 0').bind(day, row.id).first();
  const out = { username: row.username, since: row.created_at, profile: JSON.parse(row.profile || '{}'), today: today ? { ...today, rank } : null, arenaToday: arena || null };
  if (viewer) out.friend = !!(await env.DB.prepare('SELECT 1 FROM friends WHERE account_id = ? AND friend_id = ?').bind(viewer.id, row.id).first());
  return out;
}

export async function handleAccounts(req, env, url, cors) {
  const path = url.pathname, method = req.method;
  if (path === '/api/v1/auth/register' && method === 'POST') return register(req, env, cors);
  if (path === '/api/v1/auth/login' && method === 'POST') return login(req, env, cors);
  const pilot = path.match(/^\/api\/v1\/pilots\/([A-Za-z0-9_]{3,16})$/);
  if (pilot && method === 'GET') {
    const row = await env.DB.prepare('SELECT id, username, profile, created_at FROM accounts WHERE username = ? COLLATE NOCASE').bind(pilot[1]).first();
    if (!row) return json({ error: 'not_found' }, 404, cors);
    return json(await publicProfile(env, row, await accountFor(env, req)), 200, cors);
  }
  if (!path.startsWith('/api/v1/me') && path !== '/api/v1/auth/logout') return null;
  const me = await accountFor(env, req);
  if (!me) return json({ error: 'unauthorized' }, 401, cors);
  if (path === '/api/v1/auth/logout' && method === 'POST') {
    const token = (req.headers.get('authorization') || '').slice(7);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, cors);
  }
  if (path === '/api/v1/me' && method === 'GET') {
    const row = await env.DB.prepare('SELECT username, profile FROM accounts WHERE id = ?').bind(me.id).first();
    return json({ username: row.username, profile: JSON.parse(row.profile || '{}') }, 200, cors);
  }
  if (path === '/api/v1/me/profile' && method === 'PUT') {
    const b = await readBody(req);
    if (!b) return json({ error: 'bad_body' }, 400, cors);
    const profile = JSON.stringify(cleanProfile(b.profile));
    if (profile.length > MAX_PROFILE) return json({ error: 'too_large' }, 413, cors);
    await env.DB.prepare('UPDATE accounts SET profile = ?, updated_at = ? WHERE id = ?').bind(profile, Date.now(), me.id).run();
    return json({ ok: true }, 200, cors);
  }
  if (path === '/api/v1/me/friends' && method === 'GET') {
    const rows = (await env.DB.prepare('SELECT a.id, a.username, a.profile, a.created_at FROM friends f JOIN accounts a ON a.id = f.friend_id WHERE f.account_id = ? ORDER BY f.created_at DESC').bind(me.id).all()).results || [];
    const friends = [];
    for (const r of rows) { const pp = await publicProfile(env, r, null); friends.push({ username: pp.username, profile: pp.profile, today: pp.today, arenaToday: pp.arenaToday }); }
    return json({ friends }, 200, cors);
  }
  if (path === '/api/v1/me/friends' && method === 'POST') {
    const b = await readBody(req);
    if (!b || !validUsername(b.username)) return json({ error: 'bad_username' }, 422, cors);
    const f = await env.DB.prepare('SELECT id, username FROM accounts WHERE username = ? COLLATE NOCASE').bind(b.username).first();
    if (!f) return json({ error: 'not_found' }, 404, cors);
    if (f.id === me.id) return json({ error: 'self' }, 422, cors);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM friends WHERE account_id = ?').bind(me.id).first();
    if (n.n >= MAX_FRIENDS) return json({ error: 'too_many' }, 422, cors);
    await env.DB.prepare('INSERT INTO friends (account_id, friend_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(me.id, f.id, Date.now()).run();
    return json({ ok: true, username: f.username }, 201, cors);
  }
  if (path === '/api/v1/me/password' && method === 'POST') {
    if (await rateLimited(req, env)) return json({ error: 'rate_limited' }, 429, cors);
    const b = await readBody(req);
    if (!b || !validPassword(b.password)) return json({ error: 'bad_password' }, 422, cors);
    const a = await env.DB.prepare('SELECT pass_hash, salt FROM accounts WHERE id = ?').bind(me.id).first();
    if (!a || typeof b.old !== 'string' || !sameString(await hashPassword(b.old, a.salt), a.pass_hash)) return json({ error: 'bad_login' }, 401, cors);
    const salt = randomHex(16);
    await env.DB.prepare('UPDATE accounts SET pass_hash = ?, salt = ?, updated_at = ? WHERE id = ?').bind(await hashPassword(b.password, salt), salt, Date.now(), me.id).run();
    const token = (req.headers.get('authorization') || '').slice(7);
    await env.DB.prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash != ?').bind(me.id, await sha256(token)).run();
    return json({ ok: true }, 200, cors);
  }
  if (path === '/api/v1/me/logout-all' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(me.id).run();
    return json({ ok: true }, 200, cors);
  }
  if (path === '/api/v1/me' && method === 'DELETE') {
    if (await rateLimited(req, env)) return json({ error: 'rate_limited' }, 429, cors);
    const b = await readBody(req);
    const a = await env.DB.prepare('SELECT pass_hash, salt FROM accounts WHERE id = ?').bind(me.id).first();
    if (!a || !b || typeof b.password !== 'string' || !sameString(await hashPassword(b.password, a.salt), a.pass_hash)) return json({ error: 'bad_login' }, 401, cors);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(me.id),
      env.DB.prepare('DELETE FROM friends WHERE account_id = ? OR friend_id = ?').bind(me.id, me.id),
      env.DB.prepare('UPDATE scores SET account_id = NULL WHERE account_id = ?').bind(me.id),
      env.DB.prepare('UPDATE arena_scores SET account_id = NULL WHERE account_id = ?').bind(me.id),
      env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(me.id),
    ]);
    return json({ ok: true }, 200, cors);
  }
  const del = path.match(/^\/api\/v1\/me\/friends\/([A-Za-z0-9_]{3,16})$/);
  if (del && method === 'DELETE') {
    const f = await env.DB.prepare('SELECT id FROM accounts WHERE username = ? COLLATE NOCASE').bind(del[1]).first();
    if (f) await env.DB.prepare('DELETE FROM friends WHERE account_id = ? AND friend_id = ?').bind(me.id, f.id).run();
    return json({ ok: true }, 200, cors);
  }
  return json({ error: 'not_found' }, 404, cors);
}
