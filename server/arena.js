// Arena: free-for-all dogfights for up to 12 pilots, one Durable Object per arena.
//
// The arena owns everything that decides a fight: hull, shields, kills, respawns, power-ups,
// rounds and the AI pilots that keep a quiet arena busy. Each pilot flies their own plane and
// tells the arena where it is; the arena sends everyone a world update ten times a second.
//
// Who decides a hit:
//   guns and rail guns  the shooter (what you see is what you hit), checked against range and a damage budget
//   missiles and mines  the target (so a well-timed roll really does dodge them)
//
//   client -> arena:  hello {name, plane, livery}       me {plane, livery}
//                     p {x, y, a, r, rl}                 pilot state, about 12 per second
//                     hit {h: [[target, dmg, w, ref]]}   gun ('g') and rail ('r') hits by this pilot
//                     hv {h: [[by, w, ref]]}             missile ('m') and mine ('n') hits on this pilot
//                     f {w, x, y, a, tg, ref}            special weapon fired
//                     pk {id}                            touching a power-up
//                     ul {m: [ref]}                      a roll broke these missile locks
//   arena -> client:  welcome, roster, w (world), f, ul, kill, spawn, pk, pg, mx, s (scores), round, error

import { serverDay } from './day.js';

export const ARENA_MAX = 12;
export const ARENA_R = 2200;
export const ROUND_MS = 4 * 60 * 1000;
export const INTERMISSION_MS = 10 * 1000;
export const RESPAWN_MS = 2500;
export const SPAWN_SHIELD_MS = 2000;
export const MAX_HP = 10;
const TICK_MS = 100;
const BOT_FLOOR = 8; // public arenas top up to this many pilots with AI pilots
const THEMES = ['ww2', 'ww1', 'modern', 'space', 'neon'];
const BLOCKED = /(fuck|shit|cunt|nigg|fag|bitch|rape|nazi|hitler|kike|retard|whore|slut)/i;
const PLANE_IDS = { ww1: ['camel', 'dr1', 'spad'], ww2: ['hellcat', 'corsair', 'p38'], modern: ['f16', 'f18', 'f15'], space: ['lancer', 'wraith', 'bulwark'], neon: ['vector', 'overdrive', 'pulse'] };
const REVENGE_BONUS = 75;
const BOT_NAMES = ['Viper', 'Ghost', 'Maverick', 'Kestrel', 'Nova', 'Raptor', 'Falcon', 'Talon', 'Havoc', 'Comet', 'Banshee', 'Jester', 'Rook', 'Wolfhound', 'Sabre', 'Hornet'];

// Power-ups. Weapons replace each other; the rest stack with whatever you carry.
export const PICKUPS = {
  m: { name: 'Missiles', ammo: 3, weight: 16 },
  r: { name: 'Rail gun', ammo: 3, weight: 11 },
  n: { name: 'Mines', ammo: 4, weight: 10 },
  s: { name: 'Spread guns', ms: 12000, weight: 14 },
  f: { name: 'Rapid fire', ms: 10000, weight: 14 },
  h: { name: 'Shield', pts: 6, ms: 15000, weight: 12 },
  w: { name: 'Repair', weight: 12 },
  b: { name: 'Afterburner', ms: 6000, weight: 11 },
};
export const DAMAGE = { g: 1, r: 7, m: 5, n: 6 };
const GUN_RANGE = 820;          // bullets travel ~620; the rest is latency slack
const GUN_RATE = 21;            // bullets per second for a standard plane, both guns
const PICK_RANGE = 170;

export function cleanName(s) {
  s = String(s || '').replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!s || BLOCKED.test(s.replace(/[^a-z]/gi, ''))) return 'Pilot';
  return s;
}
const small = (v, max) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= max ? n : 0; };
const num = (v, lim) => { const n = Number(v); return Number.isFinite(n) ? Math.max(-lim, Math.min(lim, n)) : 0; };
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function pickKind(r = Math.random()) {
  const total = Object.values(PICKUPS).reduce((s, p) => s + p.weight, 0);
  let x = r * total;
  for (const [k, p] of Object.entries(PICKUPS)) { if ((x -= p.weight) <= 0) return k; }
  return 'm';
}

// Kill points: 100, plus 25 for each kill already in your streak (up to +200), plus a
// shutdown bonus for ending someone else's streak of 3 or more.
export function killPoints(streakAfter, victimStreak) {
  return 100 + Math.min(200, 25 * (streakAfter - 1)) + (victimStreak >= 3 ? 50 * victimStreak : 0);
}

export class ArenaRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.s = null;          // arena state, rebuilt if the object restarts
    this.timer = null;
    this.roundMs = Number(env && env.ARENA_ROUND_MS) || ROUND_MS; // shorter rounds for local testing
  }

  // ---------- state ----------
  async load(name, opts) {
    if (this.s) return this.s;
    const saved = (await this.ctx.storage.get('cfg')) || null;
    const cfg = saved || (opts ? { name, private: !!opts.private, theme: opts.theme || null, bots: opts.bots !== false, created: Date.now() } : null);
    if (!cfg) return null;
    if (!saved) await this.ctx.storage.put('cfg', cfg);
    const themeIdx = cfg.theme ? THEMES.indexOf(cfg.theme) : (hash(cfg.name) + Math.floor(Date.now() / 86400000)) % THEMES.length;
    this.s = {
      cfg, nextId: 1, pilots: new Map(), pickups: new Map(), mines: new Map(), fired: new Map(), nextPick: 1, nextMine: 1,
      round: { n: 1, themeIdx: Math.max(0, themeIdx), phase: 'play', ends: Date.now() + this.roundMs, started: Date.now(), seed: seedFor(cfg.name, 1) },
      tick: 0, lastReport: 0,
    };
    // Pilots still connected after a restart get their place back with fresh stats.
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.id) { this.s.nextId = Math.max(this.s.nextId, a.id + 1); this.addPilot(a.id, a, ws); }
    }
    return this.s;
  }
  get theme() { return THEMES[this.s.round.themeIdx]; }
  humans() { return [...this.s.pilots.values()].filter(p => !p.bot); }
  addPilot(id, info, ws) {
    const p = {
      id, name: cleanName(info.name), plane: small(info.plane, 2), livery: small(info.livery, 2), bot: !!info.bot, ws: ws || null,
      device: /^[A-Za-z0-9-]{8,64}$/.test(info.device || '') ? info.device : null, lastKiller: 0,
      x: 0, y: 0, a: 0, r: 0, rl: false, hp: MAX_HP, alive: false, respawnAt: Date.now() + 300, protUntil: 0,
      kills: 0, deaths: 0, score: 0, streak: 0, best: 0,
      weapon: null, ammo: 0, spreadUntil: 0, rapidUntil: 0, boostUntil: 0, shield: 0, shieldUntil: 0,
      budget: 8, budgetT: Date.now(), lastP: Date.now(), joined: Date.now(),
      ai: info.bot ? { tg: null, tgT: 0, wander: Math.random() * Math.PI * 2, skill: 0.75 + Math.random() * 0.35, gunT: 0 } : null,
    };
    this.s.pilots.set(id, p);
    return p;
  }

  // ---------- connections ----------
  reject(code) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.send(JSON.stringify({ t: 'error', code }));
    server.close(4000, code);
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/status')) {
      const s = await this.load(url.searchParams.get('name') || '', null);
      return Response.json(s ? { humans: this.humans().length } : { humans: 0, missing: true });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const name = url.searchParams.get('name') || 'pub-1';
    const isPrivate = name.startsWith('prv-');
    const create = url.searchParams.get('create') === '1';
    let s = this.s || await this.load(name, null);
    if (isPrivate) {
      if (create) {
        if (s && this.humans().length) return this.reject('taken');
        const theme = THEMES.includes(url.searchParams.get('theme')) ? url.searchParams.get('theme') : null;
        await this.ctx.storage.deleteAll();
        this.s = null;
        s = await this.load(name, { private: true, theme, bots: url.searchParams.get('bots') !== '0' });
      } else if (!s || !this.humans().length) return this.reject('no_room');
    } else if (!s) s = await this.load(name, { private: false });
    if (this.humans().length >= ARENA_MAX) return this.reject('full');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = s.nextId++;
    this.ctx.acceptWebSocket(server);
    const info = { id, name: url.searchParams.get('callsign') || 'Pilot', plane: 0, livery: 0, device: url.searchParams.get('device') || '' };
    server.serializeAttachment(info);
    const p = this.addPilot(id, info, server);
    await this.ctx.storage.deleteAlarm();
    this.balanceBots();
    server.send(JSON.stringify(this.welcome(p)));
    this.sendRoster();
    this.startTicking();
    this.report();
    return new Response(null, { status: 101, webSocket: client });
  }

  welcome(p) {
    const s = this.s, now = Date.now();
    return {
      t: 'welcome', you: p.id, R: ARENA_R, max: ARENA_MAX, hp: MAX_HP, name: s.cfg.name, private: s.cfg.private,
      code: s.cfg.private ? s.cfg.name.slice(4) : null,
      round: this.roundInfo(now), roster: this.roster(),
      pk: [...s.pickups.values()].map(k => [k.id, Math.round(k.x), Math.round(k.y), k.k]),
      mines: [...s.mines.values()].map(m => [m.id, Math.round(m.x), Math.round(m.y), m.o]),
    };
  }
  roundInfo(now) {
    const r = this.s.round;
    return { n: r.n, theme: this.theme, phase: r.phase, left: Math.max(0, r.ends - now), seed: r.seed };
  }
  roster() { return [...this.s.pilots.values()].map(p => [p.id, p.name, p.plane, p.livery, p.bot ? 1 : 0]); }
  sendRoster() { this.broadcast({ t: 'roster', r: this.roster() }); }
  broadcast(obj, except) {
    const raw = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) { try { ws.send(raw); } catch (e) { /* closing */ } }
  }
  sendTo(p, obj) { if (p.ws) { try { p.ws.send(JSON.stringify(obj)); } catch (e) { /* closing */ } } }

  pilotFor(ws) {
    const a = ws.deserializeAttachment();
    return a && this.s ? this.s.pilots.get(a.id) : null;
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 4000) return;
    if (!this.s) await this.load('', null);
    if (!this.s) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    const p = this.pilotFor(ws);
    if (!p) return;
    const now = Date.now();
    switch (m.t) {
      case 'hello':
      case 'me': {
        if ('name' in m) p.name = cleanName(m.name);
        if ('plane' in m) p.plane = small(m.plane, 2);
        if ('livery' in m) p.livery = small(m.livery, 2);
        ws.serializeAttachment({ id: p.id, name: p.name, plane: p.plane, livery: p.livery, device: p.device || '' });
        this.sendRoster();
        break;
      }
      case 'p': {
        if (!p.alive) { p.lastP = now; return; }
        const x = num(m.x, ARENA_R * 1.6), y = num(m.y, ARENA_R * 1.6);
        // A pilot can't outrun an afterburning roll; anything faster is ignored.
        const dt = Math.max(0.05, (now - p.lastP) / 1000);
        if (Math.hypot(x - p.x, y - p.y) <= 900 * dt + 80) { p.x = x; p.y = y; }
        p.a = num(m.a, 700) / 100; p.r = num(m.r, 1300) / 100; p.rl = !!m.rl; p.lastP = now;
        break;
      }
      case 'hit': this.onHits(p, m.h, now); break;
      case 'hv': this.onVictimHits(p, m.h, now); break;
      case 'f': this.onFire(p, m, now); break;
      case 'pk': this.onPick(p, m.id, now); break;
      case 'ul': if (Array.isArray(m.m)) this.broadcast({ t: 'ul', o: p.id, m: m.m.slice(0, 8).map(Number) }, ws); break;
      default: break;
    }
  }

  async leave(ws) {
    if (!this.s) await this.load('', null);
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    if (!this.s) return;
    const p = this.pilotFor(ws);
    if (p && p.ws === ws) this.s.pilots.delete(p.id);
    this.balanceBots();
    this.sendRoster();
    this.report();
    if (!this.humans().length) {
      this.stopTicking();
      if (this.s.cfg.private) await this.ctx.storage.setAlarm(Date.now() + 10 * 60 * 1000);
    }
  }
  async webSocketClose(ws) { await this.leave(ws); }
  async webSocketError(ws) { await this.leave(ws); }
  async alarm() { if (!this.ctx.getWebSockets().length) { await this.ctx.storage.deleteAll(); this.s = null; } }

  // ---------- matchmaking ----------
  report() {
    if (!this.s || this.s.cfg.private || !this.env.ARENA_DIR) return;
    const n = this.humans().length;
    this.s.lastReport = Date.now();
    const dir = this.env.ARENA_DIR.get(this.env.ARENA_DIR.idFromName('global'));
    this.ctx.waitUntil(dir.fetch('https://dir/report', { method: 'POST', body: JSON.stringify({ name: this.s.cfg.name, humans: n }) }).catch(() => {}));
  }

  balanceBots() {
    const s = this.s;
    const humans = this.humans().length;
    const want = s.cfg.bots && humans ? Math.max(0, Math.min(ARENA_MAX - humans, BOT_FLOOR - humans)) : 0;
    const bots = [...s.pilots.values()].filter(p => p.bot);
    for (let i = bots.length; i < want; i++) {
      const used = new Set([...s.pilots.values()].map(p => p.name));
      const name = BOT_NAMES.find(n => !used.has(n)) || `Bot ${s.nextId}`;
      this.addPilot(s.nextId++, { name, plane: Math.floor(Math.random() * 3), livery: Math.floor(Math.random() * 3), bot: true });
    }
    // Retire the weakest bots first so a newcomer doesn't shuffle the leaderboard.
    bots.sort((a, b) => a.score - b.score);
    for (let i = 0; i < bots.length - want; i++) s.pilots.delete(bots[i].id);
  }

  // ---------- the clock ----------
  startTicking() {
    if (this.timer) return;
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { /* keep the arena alive */ } }, TICK_MS);
  }
  stopTicking() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  tick(now = Date.now()) {
    const s = this.s;
    if (!s) return;
    s.tick++;
    const r = s.round;
    if (r.phase === 'play' && now >= r.ends) this.endRound(now);
    else if (r.phase === 'end' && now >= r.ends) this.startRound(now);

    for (const p of s.pilots.values()) {
      if (!p.alive && now >= p.respawnAt) this.spawn(p, now);
      if (p.shield > 0 && now > p.shieldUntil) p.shield = 0;
      if (!p.bot && now - p.lastP > 25000 && p.ws) { try { p.ws.close(4001, 'idle'); } catch (e) { /* gone */ } }
    }
    this.botTick(0.1, now);
    this.keepPickups(now);
    for (const [id, m] of s.mines) if (now > m.until) s.mines.delete(id);
    for (const [ref, f] of s.fired) if (now - f.at > 8000) s.fired.delete(ref);

    this.broadcast(this.world(now));
    if (s.tick % 10 === 0) this.broadcast({ t: 's', b: this.board() });
    if (now - s.lastReport > 30000) this.report();
  }

  world(now) {
    const out = [];
    for (const p of this.s.pilots.values()) {
      const fl = (p.alive ? 1 : 0) | (p.shield > 0 ? 2 : 0) | (now < p.boostUntil ? 4 : 0) | (now < p.rapidUntil ? 8 : 0) | (now < p.spreadUntil ? 16 : 0) | (now < p.protUntil ? 32 : 0) | (p.rl ? 64 : 0);
      out.push([p.id, Math.round(p.x), Math.round(p.y), Math.round(p.a * 100), Math.round(p.r * 100), p.hp, fl, p.weapon ? p.weapon + p.ammo : '']);
    }
    return { t: 'w', p: out, left: Math.max(0, this.s.round.ends - now) };
  }
  board() {
    return [...this.s.pilots.values()].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths).map(p => [p.id, p.kills, p.deaths, p.score, p.streak]);
  }

  // ---------- rounds ----------
  endRound(now) {
    const s = this.s;
    s.round.phase = 'end'; s.round.ends = now + INTERMISSION_MS;
    const top = this.board();
    const best = {};
    for (const p of s.pilots.values()) best[p.id] = p.best;
    this.broadcast({ t: 'round', ...this.roundInfo(now), board: top, best, next: THEMES[(s.round.themeIdx + 1) % THEMES.length] });
    this.recordRound(top, now);
  }
  // Add each person's round to today's arena leaderboard. Pilots who were only around for
  // the last few seconds and did nothing aren't counted.
  recordRound(top, now) {
    if (!this.env.DB) return;
    const day = serverDay(now), theme = this.theme, s = this.s;
    const stmts = [];
    for (const p of s.pilots.values()) {
      if (p.bot || !p.device) continue;
      const present = now - Math.max(p.joined, s.round.started || 0);
      if (present < 45000 && !p.kills && !p.deaths) continue;
      const win = top.length > 1 && top[0][0] === p.id && p.score > 0 ? 1 : 0;
      stmts.push(this.env.DB.prepare(
        `INSERT INTO arena_scores (day, device_id, name, plane, livery, kills, deaths, rounds, wins, best_round, best_streak, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(day, device_id) DO UPDATE SET name = excluded.name, plane = excluded.plane, livery = excluded.livery,
           kills = kills + excluded.kills, deaths = deaths + excluded.deaths, rounds = rounds + 1, wins = wins + excluded.wins,
           best_round = MAX(best_round, excluded.best_round), best_streak = MAX(best_streak, excluded.best_streak), updated_at = excluded.updated_at`
      ).bind(day, p.device, p.name, (PLANE_IDS[theme] || [])[p.plane] || null, p.livery, p.kills, p.deaths, win, p.score, p.best, now));
    }
    if (stmts.length) this.ctx.waitUntil(this.env.DB.batch(stmts).catch(() => {}));
  }
  startRound(now) {
    const s = this.s, r = s.round;
    r.n++; r.themeIdx = s.cfg.theme && s.cfg.private ? r.themeIdx : (r.themeIdx + 1) % THEMES.length;
    r.phase = 'play'; r.ends = now + this.roundMs; r.started = now; r.seed = seedFor(s.cfg.name, r.n);
    s.pickups.clear(); s.mines.clear(); s.fired.clear();
    // Announce the round first so clients have the new theater loaded before the respawns land.
    this.broadcast({ t: 'round', ...this.roundInfo(now) });
    for (const p of s.pilots.values()) {
      Object.assign(p, { kills: 0, deaths: 0, score: 0, streak: 0, best: 0, lastKiller: 0, weapon: null, ammo: 0, spreadUntil: 0, rapidUntil: 0, boostUntil: 0, shield: 0 });
      this.spawn(p, now);
    }
    this.broadcast({ t: 's', b: this.board() });
  }

  // Spawn where nobody is: the candidate point farthest from every pilot in the air.
  spawn(p, now) {
    const others = [...this.s.pilots.values()].filter(o => o !== p && o.alive);
    let best = null, bestD = -1;
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * ARENA_R * 0.72;
      const c = { x: Math.cos(ang) * d, y: Math.sin(ang) * d };
      const md = others.length ? Math.min(...others.map(o => Math.hypot(o.x - c.x, o.y - c.y))) : 9999;
      if (md > bestD) { bestD = md; best = c; }
    }
    p.x = best.x; p.y = best.y; p.a = Math.atan2(-best.y, -best.x) + (Math.random() - 0.5);
    p.hp = MAX_HP; p.alive = true; p.protUntil = now + SPAWN_SHIELD_MS; p.lastP = now; p.rl = false;
    p.weapon = null; p.ammo = 0;
    if (p.ai) p.ai.tg = null;
    this.broadcast({ t: 'spawn', id: p.id, x: Math.round(p.x), y: Math.round(p.y), a: Math.round(p.a * 100) });
  }

  // ---------- damage ----------
  canHit(v, now) { return v && v.alive && now >= v.protUntil && this.s.round.phase === 'play'; }

  damage(v, by, w, dmg, now) {
    if (!this.canHit(v, now)) return;
    if (v.shield > 0) { const take = Math.min(v.shield, dmg); v.shield -= take; dmg -= take; }
    if (dmg <= 0) return;
    v.hp -= dmg;
    if (v.hp > 0) return;
    v.hp = 0; v.alive = false; v.deaths++; v.respawnAt = now + RESPAWN_MS;
    v.spreadUntil = 0; v.rapidUntil = 0; v.boostUntil = 0; v.shield = 0;
    const victimStreak = v.streak; v.streak = 0;
    const k = by && by !== v ? by : null;
    let pts = 0, rv = 0;
    if (k) {
      k.kills++; k.streak++; k.best = Math.max(k.best, k.streak); pts = killPoints(k.streak, victimStreak);
      // Revenge: shooting down whoever shot you down last.
      if (k.lastKiller === v.id) { rv = 1; pts += REVENGE_BONUS; k.lastKiller = 0; }
      k.score += pts;
    }
    v.lastKiller = k ? k.id : 0;
    this.broadcast({ t: 'kill', v: v.id, by: k ? k.id : 0, w, st: k ? k.streak : 0, vs: victimStreak, pts, rv, rs: RESPAWN_MS });
  }

  // Shooter-side hits (guns, rail). Each pilot gets a damage budget that refills at the rate
  // their guns can actually fire, so a modified client can't out-damage an honest one.
  onHits(p, list, now) {
    if (!Array.isArray(list) || !p.alive) return;
    const rate = GUN_RATE * (now < p.rapidUntil ? 2 : 1) * (now < p.spreadUntil ? 1.6 : 1) * 1.25;
    p.budget = Math.min(rate * 0.3, p.budget + rate * (now - p.budgetT) / 1000); p.budgetT = now;
    for (const h of list.slice(0, 16)) {
      if (!Array.isArray(h)) continue;
      const v = this.s.pilots.get(Number(h[0])), w = h[2] === 'r' || h[2] === 'm' ? h[2] : 'g';
      if (!v || v === p || v.rl) continue;
      if (Math.hypot(v.x - p.x, v.y - p.y) > (w === 'g' ? GUN_RANGE : 1250)) continue;
      if (w === 'm') {
        // AI pilots can't report a missile hit themselves, so the shooter does.
        const f = this.s.fired.get(Number(h[3]));
        if (!v.bot || !f || f.o !== p.id || f.w !== 'm' || f.tg !== v.id || f.hit.size || now - f.at > 7000) continue;
        f.hit.add(v.id);
        this.damage(v, p, 'm', DAMAGE.m, now);
      } else if (w === 'r') {
        const f = this.s.fired.get(Number(h[3]));
        if (!f || f.o !== p.id || f.w !== 'r' || now - f.at > 1500 || f.hit.has(v.id) || f.hit.size >= 3) continue;
        f.hit.add(v.id);
        this.damage(v, p, 'r', DAMAGE.r, now);
      } else {
        const n = Math.min(clamp(Math.floor(Number(h[1]) || 0), 0, 12), Math.floor(p.budget));
        if (n <= 0) continue;
        p.budget -= n;
        this.damage(v, p, 'g', n * DAMAGE.g, now);
      }
    }
  }

  // Target-side hits (missiles, mines): the pilot who got hit says what hit them.
  onVictimHits(v, list, now) {
    if (!Array.isArray(list) || !v.alive) return;
    for (const h of list.slice(0, 6)) {
      if (!Array.isArray(h)) continue;
      const w = h[1], ref = Number(h[2]);
      if (w === 'm') {
        const f = this.s.fired.get(ref);
        if (!f || f.w !== 'm' || f.tg !== v.id || f.hit.size || now - f.at > 7000) continue;
        f.hit.add(v.id);
        this.damage(v, this.s.pilots.get(f.o), 'm', DAMAGE.m, now);
      } else if (w === 'n') {
        const mine = this.s.mines.get(ref);
        if (!mine || mine.o === v.id || Math.hypot(mine.x - v.x, mine.y - v.y) > 140) continue;
        this.s.mines.delete(ref);
        this.broadcast({ t: 'mx', id: ref });
        this.damage(v, this.s.pilots.get(mine.o), 'n', DAMAGE.n, now);
      }
    }
  }

  onFire(p, m, now) {
    if (!p.alive || !p.weapon || p.ammo <= 0 || m.w !== p.weapon) return;
    const ref = Number(m.ref) || 0;
    const x = num(m.x, ARENA_R * 1.6), y = num(m.y, ARENA_R * 1.6), a = num(m.a, 700) / 100;
    if (Math.hypot(x - p.x, y - p.y) > 400) return;
    p.ammo--;
    if (p.ammo <= 0) p.weapon = null;
    if (m.w === 'n') {
      const id = this.s.nextMine++;
      this.s.mines.set(id, { id, x, y, o: p.id, until: now + 25000 });
      this.broadcast({ t: 'f', o: p.id, w: 'n', x: Math.round(x), y: Math.round(y), id });
      return;
    }
    const tg = Number(m.tg) || 0;
    this.s.fired.set(ref, { o: p.id, w: m.w, tg, at: now, hit: new Set() });
    this.broadcast({ t: 'f', o: p.id, w: m.w, x: Math.round(x), y: Math.round(y), a: Math.round(a * 100), tg, ref }, p.ws);
  }

  // ---------- power-ups ----------
  keepPickups(now) {
    const s = this.s, want = 7 + Math.ceil(s.pilots.size / 2);
    if (s.round.phase !== 'play' || s.pickups.size >= want || s.tick % 5) return;
    const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * ARENA_R * 0.86;
    const k = { id: s.nextPick++, x: Math.cos(ang) * d, y: Math.sin(ang) * d, k: pickKind() };
    s.pickups.set(k.id, k);
    this.broadcast({ t: 'pk', id: k.id, x: Math.round(k.x), y: Math.round(k.y), k: k.k });
  }
  onPick(p, id, now) {
    const k = this.s.pickups.get(Number(id));
    if (!k || !p.alive || Math.hypot(k.x - p.x, k.y - p.y) > PICK_RANGE) return;
    this.grant(p, k, now);
  }
  grant(p, k, now) {
    this.s.pickups.delete(k.id);
    const def = PICKUPS[k.k];
    if (def.ammo) { p.weapon = k.k; p.ammo = def.ammo; }
    else if (k.k === 's') p.spreadUntil = now + def.ms;
    else if (k.k === 'f') p.rapidUntil = now + def.ms;
    else if (k.k === 'b') p.boostUntil = now + def.ms;
    else if (k.k === 'h') { p.shield = def.pts; p.shieldUntil = now + def.ms; }
    else if (k.k === 'w') p.hp = MAX_HP;
    this.broadcast({ t: 'pg', id: k.id, by: p.id, k: k.k });
  }

  // ---------- AI pilots ----------
  // Bots fly the same planes with slightly slower turns. Their guns are resolved here: a bot
  // that holds its aim on a target in range lands roughly the hits a decent pilot would.
  botTick(dt, now) {
    const s = this.s;
    const pilots = [...s.pilots.values()];
    for (const b of pilots) {
      if (!b.bot || !b.alive) continue;
      const ai = b.ai;
      ai.tgT -= dt;
      let tg = ai.tg ? s.pilots.get(ai.tg) : null;
      if (!tg || !tg.alive || ai.tgT <= 0 || Math.hypot(tg.x - b.x, tg.y - b.y) > 1500) {
        tg = null; let bd = 1500;
        for (const o of pilots) {
          if (o === b || !o.alive || now < o.protUntil) continue;
          const d = Math.hypot(o.x - b.x, o.y - b.y);
          if (d < bd) { bd = d; tg = o; }
        }
        ai.tg = tg ? tg.id : null; ai.tgT = 3 + Math.random() * 2;
      }
      // Head for a nearby power-up when nobody is close.
      let want;
      if (tg) {
        const d = Math.hypot(tg.x - b.x, tg.y - b.y), lead = d / 1030;
        want = Math.atan2(tg.y + Math.sin(tg.a) * 260 * lead - b.y, tg.x + Math.cos(tg.a) * 260 * lead - b.x);
        if (d < 150) want += 1.1;
      } else {
        let pk = null, pd = 900;
        for (const k of s.pickups.values()) { const d = Math.hypot(k.x - b.x, k.y - b.y); if (d < pd) { pd = d; pk = k; } }
        ai.wander += (Math.random() - 0.5) * 0.4;
        want = pk ? Math.atan2(pk.y - b.y, pk.x - b.x) : ai.wander;
        if (pk && pd < 60) this.grant(b, pk, now);
      }
      if (Math.hypot(b.x, b.y) > ARENA_R - 180) want = Math.atan2(-b.y, -b.x);
      for (const [id, mine] of s.mines) {
        if (mine.o !== b.id && Math.hypot(mine.x - b.x, mine.y - b.y) < 36 && this.canHit(b, now)) {
          s.mines.delete(id);
          this.broadcast({ t: 'mx', id });
          this.damage(b, s.pilots.get(mine.o), 'n', DAMAGE.n, now);
          if (!b.alive) break;
        }
      }
      if (!b.alive) continue;
      const turn = 3.5 * ai.skill;
      b.a = wrap(b.a + clamp(wrap(want - b.a) * 4, -turn, turn) * dt);
      const sp = 255 * (now < b.boostUntil ? 1.45 : 1);
      b.x += Math.cos(b.a) * sp * dt; b.y += Math.sin(b.a) * sp * dt;
      b.r = clamp(wrap(want - b.a) * 0.5, -0.6, 0.6);
      if (!tg) continue;
      const d = Math.hypot(tg.x - b.x, tg.y - b.y), err = Math.abs(wrap(Math.atan2(tg.y - b.y, tg.x - b.x) - b.a));
      if (d < 600 && err < 0.16 && !tg.rl) {
        const hits = Math.random() < 0.5 * ai.skill * (now < b.rapidUntil ? 1.8 : 1) ? 1 : 0;
        if (hits) this.damage(tg, b, 'g', hits, now);
      }
    }
  }
}

// Matchmaking: knows how many people are in each public arena and sends quick-play
// pilots to the fullest one that still has room.
export class ArenaDirectory {
  constructor(ctx) { this.ctx = ctx; this.arenas = null; }
  async load() {
    if (!this.arenas) this.arenas = (await this.ctx.storage.get('arenas')) || {};
    return this.arenas;
  }
  async fetch(req) {
    const url = new URL(req.url);
    const a = await this.load(), now = Date.now();
    if (url.pathname === '/report') {
      const b = await req.json().catch(() => ({}));
      if (typeof b.name === 'string' && b.name.startsWith('pub-')) { a[b.name] = { h: Number(b.humans) || 0, t: now, res: 0 }; await this.ctx.storage.put('arenas', a); }
      return Response.json({ ok: true });
    }
    if (url.pathname === '/assign') {
      const name = assignArena(a, now);
      a[name] = a[name] || { h: 0, t: now, res: 0 };
      a[name].res = (a[name].res || 0) + 1; a[name].resT = now;
      await this.ctx.storage.put('arenas', a);
      return Response.json({ name });
    }
    if (url.pathname === '/list') return Response.json(a);
    return new Response('not found', { status: 404 });
  }
}

// Fullest arena under 11 pilots (counting pilots who were just sent there), else the first empty one.
export function assignArena(a, now) {
  let best = null, bestN = -1;
  const count = (e) => {
    const fresh = now - e.t < 90000 ? e.h : 0;
    const reserved = e.resT && now - e.resT < 8000 ? e.res || 0 : 0;
    return fresh + reserved;
  };
  for (let i = 1; i <= 200; i++) {
    const name = `pub-${i}`, e = a[name];
    const n = e ? count(e) : 0;
    if (n < ARENA_MAX - 1 && n > bestN) { best = name; bestN = n; }
    if (!e) break;
  }
  return best || 'pub-1';
}

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function seedFor(name, n) { return `ARENA-${name}-${n}-${Math.floor(Date.now() / 1000)}`; }
