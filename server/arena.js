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
import { eliteOk, ELITE_LIVERY } from './elite.js';

export const ARENA_MAX = 12;
export const ARENA_R = 2200;
export const ROUND_MS = 4 * 60 * 1000;
export const INTERMISSION_MS = 10 * 1000;
export const RESPAWN_MS = 2500;
export const SPAWN_SHIELD_MS = 2000;
export const MAX_HP = 10;
const TICK_MS = 100;
const AWAY_MS = 30000;   // a dropped connection keeps its seat this long, so the pilot can reconnect
const IDLE_MS = 45000;   // no word from a connected pilot for this long and they're removed
const BOT_FLOOR = 8; // public arenas top up to this many pilots with AI pilots
const THEMES = ['ww2', 'ww1', 'modern', 'space', 'neon'];
const BLOCKED = /(fuck|shit|cunt|nigg|fag|bitch|rape|nazi|hitler|kike|retard|whore|slut)/i;
const PLANE_IDS = {
  ww1: ['camel', 'dr1', 'spad', 'albatros', 'nieuport', 'bristol', 'fokker7', 'se5a', 'snipe', 'eindecker', 'dolphin', 'ssw'],
  ww2: ['hellcat', 'corsair', 'p38', 'spitfire', 'mustang', 'fw190', 'p47', 'bf109', 'zero', 'me262', 'ho229', 'p82'],
  modern: ['f16', 'f18', 'f15', 'halberd', 'specter', 'nightjar', 'raptor', 'yf23', 'su57', 'sr71', 'su47', 'f117'],
  space: ['lancer', 'wraith', 'bulwark', 'striker', 'nomad', 'harbinger', 'valkyrie', 'manta', 'talon', 'seraph', 'leviathan', 'nova'],
  neon: ['vector', 'overdrive', 'pulse', 'glide', 'prism', 'razor', 'outrun', 'laserwing', 'hexa', 'synth', 'glitch', 'arcadex'],
};
export const PLANES_PER_THEATER = 12; // 9 open to everyone + 3 from crates (same handling types)
const REVENGE_BONUS = 75;
// Cosmetic choices the game offers (liveries per theater, contrails, titles); see game.html.
export const LIVERIES = 31, TRAILS = 20, TITLES = 21, BULLETS = 9, EMOTES = 8;
export const WARMUP_MS = 3500; // 3-2-1 at the start of each round: everyone flies, nobody takes damage
// Each theater has its own boss event: it crosses the arena, shoots back, takes a lot of
// punishment, and drops Overdrive (the strongest power-up, never found anywhere else).
export const BOSSES = {
  ww1: { name: 'Zeppelin', hp: 70, speed: 60, rx: 64, ry: 26, range: 460, every: 0.45, dmg: 1 },
  ww2: { name: 'Destroyer', hp: 90, speed: 45, rx: 74, ry: 18, range: 540, every: 0.35, dmg: 1 },
  modern: { name: 'Strategic bomber', hp: 75, speed: 95, rx: 50, ry: 58, range: 500, every: 0.4, dmg: 1 },
  space: { name: 'Dreadnought', hp: 110, speed: 40, rx: 80, ry: 30, range: 540, every: 0.5, dmg: 2 },
  neon: { name: 'Sentinel', hp: 80, speed: 55, rx: 44, ry: 44, range: 500, every: 0.3, dmg: 1 },
};
export const BLIMP_HP = 70; // kept for the tests; the real number comes from BOSSES
const BLIMP_FIRST_MS = 35000, BLIMP_EVERY_MS = 70000, BLIMP_POINTS = 300;
const BOSS_TIMING = { normal: [BLIMP_FIRST_MS, BLIMP_EVERY_MS], fast: [15000, 32000], off: [Infinity, Infinity] };
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
  c: { name: 'Cloak', ms: 6000, weight: 8 },
  d: { name: 'Double damage', ms: 8000, weight: 9 },
  z: { name: 'Shockwave', weight: 7 },
  v: { name: 'Vampire', ms: 15000, weight: 8 },
  x: { name: 'EMP', weight: 7 },                 // wipes nearby pilots' weapons and boosts
  t: { name: 'Wingman drone', ms: 15000, weight: 7 }, // a drone that shoots whoever is near you
  y: { name: 'Flares', ms: 12000, weight: 8 },   // missiles can't lock on, mines don't go off
  o: { name: 'Overdrive', ms: 15000, weight: 0 }, // boss drop only
};
const SHOCK_RANGE = 330, SHOCK_DMG = 4, VAMPIRE_HEAL = 5;
const EMP_RANGE = 420, DRONE_RANGE = 380, DRONE_EVERY = 0.45;
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

export function pickKind(r = Math.random(), allowed = null) {
  const list = Object.entries(PICKUPS).filter(([k, p]) => p.weight > 0 && (!allowed || allowed.includes(k)));
  if (!list.length) return null;
  const total = list.reduce((s, [, p]) => s + p.weight, 0);
  let x = r * total;
  for (const [k, p] of list) { if ((x -= p.weight) <= 0) return k; }
  return list[list.length - 1][0];
}
// Private arenas can set their own rules; public arenas use the defaults.
export const RULE_LIMITS = { max: [2, 15], round: [2, 4, 6, 8], boss: ['off', 'normal', 'fast'] };
export function parseRules(q) {
  const max = Math.round(Number(q.get('max')) || ARENA_MAX);
  const round = Number(q.get('round')) || 0;
  const boss = RULE_LIMITS.boss.includes(q.get('boss')) ? q.get('boss') : 'normal';
  const pu = q.get('pu');
  const kinds = pu == null ? null : String(pu).split(',').filter(k => PICKUPS[k] && k !== 'o');
  return {
    max: Math.max(RULE_LIMITS.max[0], Math.min(RULE_LIMITS.max[1], max)),
    round: RULE_LIMITS.round.includes(round) ? round : 0,
    boss, pu: kinds && kinds.length < Object.keys(PICKUPS).length - 1 ? kinds : null,
  };
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
    const cfg = saved || (opts ? { name, private: !!opts.private, theme: opts.theme || null, bots: opts.bots !== false, rules: opts.rules || null, created: Date.now() } : null);
    if (!cfg) return null;
    if (!saved) await this.ctx.storage.put('cfg', cfg);
    const themeIdx = cfg.theme ? THEMES.indexOf(cfg.theme) : (hash(cfg.name) + Math.floor(Date.now() / 86400000)) % THEMES.length;
    const now = Date.now();
    // If the object restarted mid-round, carry on with the same round instead of starting over.
    const kept = saved ? await this.ctx.storage.get('round') : null;
    const round = kept && kept.ends > now - INTERMISSION_MS ? kept
      : { n: 1, themeIdx: Math.max(0, themeIdx), phase: 'play', ends: now + this.roundLen(cfg) + WARMUP_MS, started: now, warmUntil: now + WARMUP_MS, seed: seedFor(cfg.name, 1) };
    this.s = {
      cfg, nextId: 1, pilots: new Map(), pickups: new Map(), mines: new Map(), fired: new Map(), nextPick: 1, nextMine: 1,
      round, tick: 0, lastReport: 0, blimp: null, nextBlimpId: 1, blimpAt: now + BOSS_TIMING[(cfg.rules && cfg.rules.boss) || 'normal'][0], nextRef: 1e9,
    };
    if (round !== kept) this.saveRound();
    // Pilots still connected after a restart keep their seat, score and plane: they stay in the
    // air where their next position update puts them.
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || !a.id) continue;
      this.s.nextId = Math.max(this.s.nextId, a.id + 1);
      const p = this.addPilot(a.id, a, ws);
      if (Array.isArray(a.st) && a.st[5] === round.n) [p.kills, p.deaths, p.score, p.streak, p.best] = a.st.map(Number);
      p.restored = true; p.respawnAt = now + 2500;
    }
    return this.s;
  }
  get theme() { return THEMES[this.s.round.themeIdx]; }
  get rules() { return (this.s && this.s.cfg.rules) || null; }
  get maxPilots() { return this.rules ? this.rules.max : ARENA_MAX; }
  bossMs(i) { return BOSS_TIMING[(this.rules && this.rules.boss) || 'normal'][i]; }
  roundLen(cfg) { const r = cfg && cfg.rules; return r && r.round && !(this.env && this.env.ARENA_ROUND_MS) ? r.round * 60000 : this.roundMs; }
  pick() { return pickKind(Math.random(), this.rules && this.rules.pu); }
  saveRound() { this.ctx.waitUntil(this.ctx.storage.put('round', this.s.round).catch(() => {})); }
  // What a pilot's connection remembers, so a restarted arena can put them back as they were.
  saveSeat(p) {
    if (!p.ws) return;
    try { p.ws.serializeAttachment({ id: p.id, name: p.name, plane: p.plane, livery: p.livery, trail: p.trail, title: p.title, device: p.device || '', account: p.account, token: p.token, st: [p.kills, p.deaths, p.score, p.streak, p.best, this.s.round.n] }); } catch (e) { /* closing */ }
  }
  // Remove a pilot for good. Their round so far still counts on the leaderboard.
  dropPilot(p, now) {
    if (!this.s.pilots.has(p.id)) return;
    if (this.s.round.phase === 'play') this.recordRound(null, now, [p]);
    this.s.pilots.delete(p.id);
    if (p.ws) { const ws = p.ws; p.ws = null; try { ws.close(4001, 'idle'); } catch (e) { /* gone */ } }
    this.balanceBots(); this.sendRoster(); this.report();
  }
  humans() { return [...this.s.pilots.values()].filter(p => !p.bot); }
  connected() { return this.humans().filter(p => !p.away); }
  addPilot(id, info, ws) {
    const p = {
      id, name: cleanName(info.name), plane: small(info.plane, PLANES_PER_THEATER - 1), livery: small(info.livery, LIVERIES - 1), trail: small(info.trail, TRAILS - 1), title: small(info.title, TITLES - 1), bot: !!info.bot, ws: ws || null,
      device: /^[A-Za-z0-9-]{8,64}$/.test(info.device || '') ? info.device : null, account: Number(info.account) || null, lastKiller: 0,
      token: info.token || null, away: false, awayAt: 0, bye: false,
      x: 0, y: 0, a: 0, r: 0, rl: false, hp: MAX_HP, alive: false, respawnAt: Date.now() + 300, protUntil: 0,
      kills: 0, deaths: 0, score: 0, streak: 0, best: 0,
      weapon: null, ammo: 0, spreadUntil: 0, rapidUntil: 0, boostUntil: 0, shield: 0, shieldUntil: 0, cloakUntil: 0, ddUntil: 0, vampUntil: 0, odUntil: 0, droneUntil: 0, droneT: 0, flareUntil: 0,
      budget: 8, budgetT: Date.now(), lastP: Date.now(), joined: Date.now(),
      ai: info.bot ? { tg: null, tgT: 0, wander: Math.random() * Math.PI * 2, skill: 0.72 + Math.random() * 0.4, gunT: 0, style: ['hunter', 'vengeful', 'opportunist', 'brawler'][Math.floor(Math.random() * 4)] } : null,
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
        s = await this.load(name, { private: true, theme, bots: url.searchParams.get('bots') !== '0', rules: parseRules(url.searchParams) });
      } else if (!s || !this.humans().length) return this.reject('no_room');
    } else if (!s) s = await this.load(name, { private: false });

    // Reconnecting after a dropped connection: same seat, same score.
    // A connection can drop without the arena noticing straight away, so the old seat may still
    // look connected. The same token (or the same device, gone quiet) takes that seat over
    // instead of adding a second copy of the pilot.
    const resume = url.searchParams.get('resume'), device = url.searchParams.get('device') || '', now0 = Date.now();
    const back = [...s.pilots.values()].find(p => !p.bot && ((resume && p.token === resume) || (p.device && p.device === device && (p.away || now0 - p.lastP > 4000))));
    if (back) {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      const old = back.ws, keep = !back.away && back.alive;
      back.ws = server; back.away = false; back.bye = false; back.lastP = now0;
      if (!keep && !back.alive) back.respawnAt = Math.min(back.respawnAt, now0 + 600);
      if (old && old !== server) { try { old.close(4002, 'replaced'); } catch (e) { /* gone */ } }
      this.saveSeat(back);
      server.send(JSON.stringify({ ...this.welcome(back), resumed: true, keep }));
      this.sendRoster();
      this.startTicking();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (this.humans().length >= this.maxPilots) return this.reject('full');

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = s.nextId++;
    this.ctx.acceptWebSocket(server);
    const info = { id, name: url.searchParams.get('callsign') || 'Pilot', plane: 0, livery: 0, device, account: Number(url.searchParams.get('acct')) || null, token: crypto.randomUUID() };
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
      t: 'welcome', you: p.id, token: p.token, R: ARENA_R, max: this.maxPilots, hp: MAX_HP, name: s.cfg.name, private: s.cfg.private, rules: s.cfg.rules || null,
      code: s.cfg.private ? s.cfg.name.slice(4) : null,
      round: this.roundInfo(now), roster: this.roster(),
      pk: [...s.pickups.values()].map(k => [k.id, Math.round(k.x), Math.round(k.y), k.k]),
      mines: [...s.mines.values()].map(m => [m.id, Math.round(m.x), Math.round(m.y), m.o]),
    };
  }
  roundInfo(now) {
    const r = this.s.round;
    return { n: r.n, theme: this.theme, phase: r.phase, left: Math.max(0, r.ends - now), seed: r.seed, warm: Math.max(0, (r.warmUntil || 0) - now) };
  }
  roster() { return [...this.s.pilots.values()].map(p => [p.id, p.name, p.plane, p.livery, p.bot ? 1 : 0, p.trail, p.title, p.bullet || 0]); }
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
    if (!this.timer) this.startTicking(); // the object may have restarted under us
    switch (m.t) {
      case 'ka': p.lastP = now; break;
      case 'bye': p.bye = true; break;
      case 'hello':
      case 'me': {
        if ('name' in m) p.name = cleanName(m.name);
        if ('plane' in m) p.plane = small(m.plane, PLANES_PER_THEATER - 1);
        if ('livery' in m) p.livery = small(m.livery, LIVERIES - 1);
        if ('trail' in m) p.trail = small(m.trail, TRAILS - 1);
        if ('title' in m) p.title = small(m.title, TITLES - 1);
        if ('bullet' in m) p.bullet = small(m.bullet, BULLETS - 1);
        // The elite livery shows only once the leaderboard confirms it.
        if (p.livery === ELITE_LIVERY && !p.eliteOk) {
          p.livery = 0;
          eliteOk(this.env, p.device, p.account).then(okd => { if (okd && this.s.pilots.get(p.id) === p) { p.eliteOk = true; p.livery = ELITE_LIVERY; this.saveSeat(p); this.sendRoster(); } }).catch(() => {});
        }
        this.saveSeat(p);
        this.sendRoster();
        break;
      }
      case 'p': {
        const x = num(m.x, ARENA_R * 1.6), y = num(m.y, ARENA_R * 1.6);
        if (!p.alive && p.restored && !m.d && this.s.round.phase === 'play') { p.restored = false; p.alive = true; p.x = x; p.y = y; p.hp = MAX_HP; p.protUntil = now + 1500; p.respawnAt = 0; }
        if (!p.alive) { p.lastP = now; return; }
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
      case 'em': {
        // Quick-chat emotes, at most one every 1.5 seconds per pilot.
        const e = small(m.e, EMOTES - 1);
        if (now - (p.emT || 0) < 1500) break;
        p.emT = now;
        this.broadcast({ t: 'em', o: p.id, e });
        break;
      }
      case 'ul': if (Array.isArray(m.m)) this.broadcast({ t: 'ul', o: p.id, m: m.m.slice(0, 8).map(Number) }, ws); break;
      default: break;
    }
  }

  async leave(ws) {
    if (!this.s) await this.load('', null);
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    if (!this.s) return;
    const p = this.pilotFor(ws);
    if (p && p.ws === ws) {
      if (p.bye || !p.token) { p.ws = null; this.dropPilot(p, Date.now()); }
      else { p.ws = null; p.away = true; p.awayAt = Date.now(); p.alive = false; p.respawnAt = Infinity; }
    }
    this.balanceBots();
    this.sendRoster();
    this.report();
    if (!this.connected().length) {
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
    const hs = this.humans(), now = Date.now(), r = this.s.round;
    this.s.lastReport = now;
    const dir = this.env.ARENA_DIR.get(this.env.ARENA_DIR.idFromName('global'));
    const info = { name: this.s.cfg.name, humans: hs.length, bots: this.s.pilots.size - hs.length, theme: this.theme, round: r.n, phase: r.phase, ends: r.ends, names: hs.slice().sort((a, b) => b.score - a.score).slice(0, 4).map(p => p.name) };
    this.ctx.waitUntil(dir.fetch('https://dir/report', { method: 'POST', body: JSON.stringify(info) }).catch(() => {}));
  }

  balanceBots() {
    const s = this.s;
    const humans = this.humans().length;
    const want = s.cfg.bots && humans ? Math.max(0, Math.min(this.maxPilots - humans, Math.min(this.maxPilots, BOT_FLOOR) - humans)) : 0;
    const bots = [...s.pilots.values()].filter(p => p.bot);
    for (let i = bots.length; i < want; i++) {
      const used = new Set([...s.pilots.values()].map(p => p.name));
      const name = BOT_NAMES.find(n => !used.has(n)) || `Bot ${s.nextId}`;
      this.addPilot(s.nextId++, { name, plane: Math.floor(Math.random() * PLANES_PER_THEATER), livery: Math.floor(Math.random() * 3), trail: Math.floor(Math.random() * 4), bot: true });
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
      if (!p.bot && !p.away && now - p.lastP > IDLE_MS) this.dropPilot(p, now);
      else if (p.away && now - p.awayAt > AWAY_MS) this.dropPilot(p, now);
    }
    this.botTick(0.1, now);
    this.droneTick(0.1, now);
    this.blimpTick(0.1, now);
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
      const fl = (p.alive ? 1 : 0) | (p.shield > 0 ? 2 : 0) | (now < p.boostUntil ? 4 : 0) | (now < p.rapidUntil ? 8 : 0) | (now < p.spreadUntil ? 16 : 0) | (now < p.protUntil ? 32 : 0) | (p.rl ? 64 : 0) | (now < p.cloakUntil ? 128 : 0) | (now < p.ddUntil ? 256 : 0) | (now < p.odUntil ? 512 : 0) | (now < p.vampUntil ? 1024 : 0) | (now < p.droneUntil ? 2048 : 0) | (now < p.flareUntil ? 4096 : 0);
      out.push([p.id, Math.round(p.x), Math.round(p.y), Math.round(p.a * 100), Math.round(p.r * 100), p.hp, fl, p.weapon ? p.weapon + p.ammo : '']);
    }
    const b = this.s.blimp;
    return { t: 'w', p: out, left: Math.max(0, this.s.round.ends - now), bl: b ? [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.a * 100), Math.max(0, Math.round(b.hp)), b.max, b.kind] : 0 };
  }
  board() {
    return [...this.s.pilots.values()].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths).map(p => [p.id, p.kills, p.deaths, p.score, p.streak]);
  }

  // ---------- rounds ----------
  endRound(now) {
    const s = this.s;
    s.round.phase = 'end'; s.round.ends = now + INTERMISSION_MS;
    this.saveRound();
    const top = this.board();
    const best = {};
    for (const p of s.pilots.values()) best[p.id] = p.best;
    this.broadcast({ t: 'round', ...this.roundInfo(now), board: top, best, next: THEMES[(s.round.themeIdx + 1) % THEMES.length] });
    this.recordRound(top, now);
  }
  // Add each person's round to today's arena leaderboard. Pilots who were only around for
  // the last few seconds and did nothing aren't counted.
  recordRound(top, now, list) {
    if (!this.env.DB) return;
    const day = serverDay(now), theme = this.theme, s = this.s;
    const stmts = [];
    for (const p of list || s.pilots.values()) {
      if (p.bot || !p.device || p.recorded === s.round.n) continue;
      const present = now - Math.max(p.joined, s.round.started || 0);
      if (present < 45000 && !p.kills && !p.deaths) continue;
      p.recorded = s.round.n;
      const win = top && top.length > 1 && top[0][0] === p.id && p.score > 0 ? 1 : 0;
      stmts.push(this.env.DB.prepare(
        `INSERT INTO arena_scores (day, device_id, name, plane, livery, kills, deaths, rounds, wins, best_round, best_streak, updated_at, account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT(day, device_id) DO UPDATE SET name = excluded.name, plane = excluded.plane, livery = excluded.livery,
           kills = kills + excluded.kills, deaths = deaths + excluded.deaths, rounds = rounds + 1, wins = wins + excluded.wins,
           best_round = MAX(best_round, excluded.best_round), best_streak = MAX(best_streak, excluded.best_streak), updated_at = excluded.updated_at, account_id = COALESCE(excluded.account_id, account_id)`
      ).bind(day, p.device, p.name, (PLANE_IDS[theme] || [])[p.plane] || null, p.livery, p.kills, p.deaths, win, p.score, p.best, now, p.account));
    }
    if (stmts.length) this.ctx.waitUntil(this.env.DB.batch(stmts).catch(() => {}));
  }
  startRound(now) {
    const s = this.s, r = s.round;
    r.n++; r.themeIdx = s.cfg.theme && s.cfg.private ? r.themeIdx : (r.themeIdx + 1) % THEMES.length;
    r.phase = 'play'; r.ends = now + this.roundLen(s.cfg) + WARMUP_MS; r.started = now; r.warmUntil = now + WARMUP_MS; r.seed = seedFor(s.cfg.name, r.n);
    this.saveRound();
    s.pickups.clear(); s.mines.clear(); s.fired.clear();
    s.blimp = null; s.blimpAt = now + this.bossMs(0);
    // Announce the round first so clients have the new theater loaded before the respawns land.
    this.broadcast({ t: 'round', ...this.roundInfo(now) });
    for (const p of s.pilots.values()) {
      Object.assign(p, { kills: 0, deaths: 0, score: 0, streak: 0, best: 0, lastKiller: 0, weapon: null, ammo: 0, spreadUntil: 0, rapidUntil: 0, boostUntil: 0, shield: 0, cloakUntil: 0, ddUntil: 0, vampUntil: 0, odUntil: 0, droneUntil: 0, flareUntil: 0 });
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
  canHit(v, now) { return v && v.alive && now >= v.protUntil && this.s.round.phase === 'play' && now >= (this.s.round.warmUntil || 0); }

  damage(v, by, w, dmg, now) {
    if (!this.canHit(v, now)) return;
    if (v.shield > 0) { const take = Math.min(v.shield, dmg); v.shield -= take; dmg -= take; }
    if (dmg <= 0) return;
    v.hp -= dmg;
    if (v.hp > 0) return;
    v.hp = 0; v.alive = false; v.deaths++; v.respawnAt = now + RESPAWN_MS;
    v.spreadUntil = 0; v.rapidUntil = 0; v.boostUntil = 0; v.shield = 0; v.cloakUntil = 0; v.ddUntil = 0; v.vampUntil = 0; v.odUntil = 0; v.droneUntil = 0; v.flareUntil = 0;
    const victimStreak = v.streak; v.streak = 0;
    const k = by && by !== v ? by : null;
    let pts = 0, rv = 0;
    if (k) {
      k.kills++; k.streak++; k.best = Math.max(k.best, k.streak); pts = killPoints(k.streak, victimStreak);
      // Revenge: shooting down whoever shot you down last.
      if (k.lastKiller === v.id) { rv = 1; pts += REVENGE_BONUS; k.lastKiller = 0; }
      k.score += pts;
      if (now < k.vampUntil) k.hp = Math.min(MAX_HP, k.hp + VAMPIRE_HEAL);
    }
    v.lastKiller = k ? k.id : 0;
    this.saveSeat(v); if (k) this.saveSeat(k);
    if (v.bot && k && !k.bot && Math.random() < 0.18) this.botEmote(v, [0, 2, 3][Math.floor(Math.random() * 3)], now);
    else if (k && k.bot && !v.bot && Math.random() < 0.12) this.botEmote(k, [1, 6, 7][Math.floor(Math.random() * 3)], now);
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
      if (Number(h[0]) === -1) { this.hitBlimp(p, h, now); continue; }
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
        this.damage(v, p, 'g', n * DAMAGE.g * (now < p.ddUntil ? 2 : 1), now);
      }
    }
  }

  // Target-side hits (missiles, mines): the pilot who got hit says what hit them.
  onVictimHits(v, list, now) {
    if (!Array.isArray(list) || !v.alive) return;
    for (const h of list.slice(0, 6)) {
      if (!Array.isArray(h)) continue;
      const w = h[1], ref = Number(h[2]);
      if (now < v.flareUntil) continue;
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

  // ---------- the supply blimp ----------
  blimpTick(dt, now) {
    const s = this.s;
    if (s.round.phase !== 'play') return;
    if (!s.blimp) {
      if (now < s.blimpAt) return;
      // Enter at the edge and cross near the middle, so every pilot gets a shot at it.
      const ang = Math.random() * Math.PI * 2, x = Math.cos(ang) * ARENA_R * 0.95, y = Math.sin(ang) * ARENA_R * 0.95;
      const a = Math.atan2(-y, -x) + (Math.random() - 0.5) * 0.6;
      const cfg = BOSSES[this.theme] || BOSSES.ww1;
      s.blimp = { id: s.nextBlimpId++, x, y, a, hp: cfg.hp, max: cfg.hp, kind: this.theme, cfg, gunT: 2 };
      this.broadcast({ t: 'bl', id: s.blimp.id, kind: this.theme, name: cfg.name });
      return;
    }
    const b = s.blimp, cfg = b.cfg;
    b.x += Math.cos(b.a) * cfg.speed * dt; b.y += Math.sin(b.a) * cfg.speed * dt;
    if (Math.hypot(b.x, b.y) > ARENA_R + 250) { s.blimp = null; s.blimpAt = now + this.bossMs(1) / 2; return; }
    // It shoots back: the turret picks the nearest pilot in range; closer pilots get hit more.
    b.gunT -= dt;
    if (b.gunT > 0) return;
    b.gunT = cfg.every * (0.8 + Math.random() * 0.4);
    let tg = null, td = cfg.range;
    for (const o of s.pilots.values()) {
      if (!o.alive || now < o.protUntil || (now < o.cloakUntil)) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (d < td) { td = d; tg = o; }
    }
    if (!tg) return;
    const hit = !tg.rl && Math.random() < 0.15 + 0.45 * (1 - td / cfg.range);
    this.broadcast({ t: 'bf', x: Math.round(b.x), y: Math.round(b.y), tx: Math.round(tg.x + (hit ? 0 : (Math.random() - 0.5) * 120)), ty: Math.round(tg.y + (hit ? 0 : (Math.random() - 0.5) * 120)), h: hit ? 1 : 0 });
    if (hit) this.damage(tg, null, 'b', cfg.dmg, now);
  }
  hitBlimp(p, h, now) {
    const b = this.s.blimp, w = h[2] === 'r' ? 'r' : 'g';
    if (!b || this.s.round.phase !== 'play' || Math.hypot(b.x - p.x, b.y - p.y) - Math.max(b.cfg.rx, b.cfg.ry) > (w === 'r' ? 1250 : GUN_RANGE)) return;
    let n;
    if (w === 'r') {
      const f = this.s.fired.get(Number(h[3]));
      if (!f || f.o !== p.id || f.w !== 'r' || now - f.at > 1500 || f.hit.has(-1)) return;
      f.hit.add(-1); n = DAMAGE.r;
    } else {
      n = Math.min(clamp(Math.floor(Number(h[1]) || 0), 0, 12), Math.floor(p.budget));
      if (n <= 0) return;
      p.budget -= n;
      if (now < p.ddUntil) n *= 2;
    }
    this.damageBlimp(p, n, now);
  }
  damageBlimp(by, n, now) {
    const s = this.s, b = s.blimp;
    if (!b) return;
    b.hp -= n;
    if (b.hp > 0) return;
    s.blimp = null; s.blimpAt = now + this.bossMs(1);
    if (by) by.score += BLIMP_POINTS;
    this.broadcast({ t: 'bx', id: b.id, x: Math.round(b.x), y: Math.round(b.y), by: by ? by.id : 0, pts: BLIMP_POINTS, kind: b.kind });
    // The drop: Overdrive, plus a weapon and a random power-up for whoever's close behind.
    const allowed = this.rules && this.rules.pu, weapons = ['m', 'r', 'n'].filter(k => !allowed || allowed.includes(k));
    const kinds = ['o', weapons.length ? weapons[Math.floor(Math.random() * weapons.length)] : null, this.pick()].filter(Boolean);
    kinds.forEach((kind, i) => {
      const a = i / 3 * Math.PI * 2 + Math.random(), d = 50 + Math.random() * 40;
      const k = { id: s.nextPick++, x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, k: kind };
      s.pickups.set(k.id, k);
      this.broadcast({ t: 'pk', id: k.id, x: Math.round(k.x), y: Math.round(k.y), k: k.k });
    });
  }

  // ---------- power-ups ----------
  keepPickups(now) {
    const s = this.s, want = 7 + Math.ceil(s.pilots.size / 2);
    if (s.round.phase !== 'play' || s.pickups.size >= want || s.tick % 5) return;
    const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * ARENA_R * 0.86;
    const kind = this.pick();
    if (!kind) return;
    const k = { id: s.nextPick++, x: Math.cos(ang) * d, y: Math.sin(ang) * d, k: kind };
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
    else if (k.k === 'c') p.cloakUntil = now + def.ms;
    else if (k.k === 'd') p.ddUntil = now + def.ms;
    else if (k.k === 'v') p.vampUntil = now + def.ms;
    else if (k.k === 't') { p.droneUntil = now + def.ms; p.droneT = 0.6; }
    else if (k.k === 'y') {
      p.flareUntil = now + def.ms;
      // Any missile already chasing you loses you.
      const refs = [...this.s.fired.entries()].filter(([, f]) => f.w === 'm' && f.tg === p.id && !f.hit.size).map(([ref]) => ref);
      for (const ref of refs) this.s.fired.get(ref).hit.add(-1);
      if (refs.length) this.broadcast({ t: 'ul', o: p.id, m: refs.slice(0, 8) });
    } else if (k.k === 'x') {
      const hit = [];
      for (const o of this.s.pilots.values()) {
        if (o === p || !o.alive || Math.hypot(o.x - p.x, o.y - p.y) > EMP_RANGE) continue;
        Object.assign(o, { weapon: null, ammo: 0, spreadUntil: 0, rapidUntil: 0, boostUntil: 0, shield: 0, cloakUntil: 0, ddUntil: 0, vampUntil: 0, droneUntil: 0, flareUntil: 0, odUntil: Math.min(o.odUntil, now) });
        hit.push(o.id);
      }
      this.broadcast({ t: 'emp', x: Math.round(p.x), y: Math.round(p.y), by: p.id, hit });
    }
    else if (k.k === 'o') {
      const until = now + def.ms;
      Object.assign(p, { odUntil: until, rapidUntil: Math.max(p.rapidUntil, until), spreadUntil: Math.max(p.spreadUntil, until), ddUntil: Math.max(p.ddUntil, until), shield: 8, shieldUntil: until, hp: MAX_HP });
    } else if (k.k === 'z') {
      this.broadcast({ t: 'sw', x: Math.round(p.x), y: Math.round(p.y), by: p.id });
      for (const o of this.s.pilots.values()) if (o !== p && Math.hypot(o.x - p.x, o.y - p.y) < SHOCK_RANGE) this.damage(o, p, 'z', SHOCK_DMG, now);
      if (this.s.blimp && Math.hypot(this.s.blimp.x - p.x, this.s.blimp.y - p.y) < SHOCK_RANGE + 60) this.damageBlimp(p, SHOCK_DMG * 2, now);
    }
    this.broadcast({ t: 'pg', id: k.id, by: p.id, k: k.k });
  }

  // ---------- AI pilots ----------
  // Bots fly the same planes. Each has a temperament and a skill; they pick targets by threat
  // and opportunity, dodge-roll missiles and pilots on their tail, weave under fire, go for
  // repairs when hurt, and use the weapons they pick up. Their hits are resolved here.
  botTick(dt, now) {
    const s = this.s;
    const pilots = [...s.pilots.values()];
    const leader = pilots.reduce((a, p) => (!a || p.score > a.score ? p : a), null);
    // missiles a bot fired at another bot land after their flight time unless the target rolled
    if (s.botShots && s.botShots.length) {
      s.botShots = s.botShots.filter(sh => {
        if (now < sh.at) return true;
        const f = s.fired.get(sh.ref), tg = s.pilots.get(sh.tg), by = s.pilots.get(sh.by);
        if (f && !f.hit.size && tg && tg.alive && !tg.rl && now >= tg.flareUntil) { f.hit.add(tg.id); this.damage(tg, by || null, 'm', DAMAGE.m, now); }
        return false;
      });
    }
    for (const b of pilots) {
      if (!b.bot || !b.alive) continue;
      const ai = b.ai;
      ai.tgT -= dt; ai.rollCd = (ai.rollCd || 0) - dt; ai.fireCd = (ai.fireCd || 0) - dt;
      if (b.rl && now > (ai.rollUntil || 0)) b.rl = false;

      // Threats: someone close behind with their nose on us, or a missile on its way.
      let threat = null, td = 460;
      for (const o of pilots) {
        if (o === b || !o.alive) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d < td && Math.abs(wrap(Math.atan2(b.y - o.y, b.x - o.x) - o.a)) < 0.35) { threat = o; td = d; }
      }
      let incoming = false;
      for (const f of s.fired.values()) if (f.w === 'm' && f.tg === b.id && !f.hit.size && now - f.at > 350 && now - f.at < 4000) { incoming = true; break; }
      if (!b.rl && ai.rollCd <= 0 && (incoming ? Math.random() < 0.06 * ai.skill : threat && td < 300 && Math.random() < 0.015 * ai.skill)) {
        b.rl = true; ai.rollUntil = now + 450; ai.rollCd = 2.0 + Math.random() * 1.6;
      }

      // Pick a target: close, in front, hurt, on a streak, the leader, or whoever shot us last.
      let tg = ai.tg ? s.pilots.get(ai.tg) : null;
      if (!tg || !tg.alive || ai.tgT <= 0 || Math.hypot(tg.x - b.x, tg.y - b.y) > 1600 || (threat && threat !== tg && Math.random() < 0.02)) {
        tg = null; let best = Infinity;
        for (const o of pilots) {
          if (o === b || !o.alive || now < o.protUntil) continue;
          const d = Math.hypot(o.x - b.x, o.y - b.y);
          if (d > 1600 || (now < o.cloakUntil && d > 220)) continue;
          const off = Math.abs(wrap(Math.atan2(o.y - b.y, o.x - b.x) - b.a));
          let sc = d + off * 260 - (MAX_HP - o.hp) * 40 - o.streak * 30;
          if (ai.style === 'hunter' && o === leader) sc -= 500;
          if (o.id === b.lastKiller) sc -= ai.style === 'vengeful' ? 600 : 250;
          if (o === threat) sc -= 350;
          if (!o.bot) sc -= 60; // a little more interested in people
          if (sc < best) { best = sc; tg = o; }
        }
        ai.tg = tg ? tg.id : null; ai.tgT = 2.5 + Math.random() * 2;
      }

      let want;
      // Anything flown through gets picked up, same as for people.
      for (const k of s.pickups.values()) if (Math.abs(k.x - b.x) < 60 && Math.abs(k.y - b.y) < 60 && Math.hypot(k.x - b.x, k.y - b.y) < 60) { this.grant(b, k, now); break; }
      // Unarmed: a weapon close by is worth a short detour.
      const arm = !b.weapon ? [...s.pickups.values()].filter(k => PICKUPS[k.k].ammo).map(k => [k, Math.hypot(k.x - b.x, k.y - b.y)]).filter(([, d]) => d < 520).sort((a, c) => a[1] - c[1])[0] : null;
      const heal = b.hp <= 4 ? [...s.pickups.values()].filter(k => k.k === 'w' || k.k === 'h').map(k => [k, Math.hypot(k.x - b.x, k.y - b.y)]).filter(([, d]) => d < 1100).sort((a, c) => a[1] - c[1])[0] : null;
      const bl = s.blimp && Math.hypot(s.blimp.x - b.x, s.blimp.y - b.y) < 1300 ? s.blimp : null;
      if (heal && (!tg || Math.hypot(tg.x - b.x, tg.y - b.y) > 380)) {
        const [k, d] = heal;
        want = Math.atan2(k.y - b.y, k.x - b.x);
        if (d < 60) this.grant(b, k, now);
        tg = null;
      } else if (arm && (!tg || Math.hypot(tg.x - b.x, tg.y - b.y) > 450)) {
        want = Math.atan2(arm[0].y - b.y, arm[0].x - b.x);
      } else if (bl && (!tg || Math.hypot(tg.x - b.x, tg.y - b.y) > (ai.style === 'opportunist' ? 1000 : 700))) {
        const d = Math.hypot(bl.x - b.x, bl.y - b.y);
        want = Math.atan2(bl.y - b.y, bl.x - b.x) + (d < 170 ? 1.2 : 0);
        if (d < 550 && Math.abs(wrap(Math.atan2(bl.y - b.y, bl.x - b.x) - b.a)) < 0.2 && Math.random() < 0.3 * ai.skill) this.damageBlimp(b, 1, now);
        tg = null;
      } else if (tg) {
        // Lead the target by its measured velocity.
        const d = Math.hypot(tg.x - b.x, tg.y - b.y), lead = Math.min(0.9, d / 1030);
        const vx = ai.lx != null && ai.lid === tg.id ? (tg.x - ai.lx) / dt : Math.cos(tg.a) * 255, vy = ai.ly != null && ai.lid === tg.id ? (tg.y - ai.ly) / dt : Math.sin(tg.a) * 255;
        ai.lx = tg.x; ai.ly = tg.y; ai.lid = tg.id;
        want = Math.atan2(tg.y + clamp(vy, -500, 500) * lead - b.y, tg.x + clamp(vx, -500, 500) * lead - b.x);
        // Head-on and too close: break off instead of ramming.
        if (d < 170) want += Math.abs(wrap(tg.a - b.a)) > 2.4 ? 1.4 : 0.9;
      } else {
        let pk = null, pd = 1000;
        for (const k of s.pickups.values()) { const d = Math.hypot(k.x - b.x, k.y - b.y) - (PICKUPS[k.k].ammo ? 150 : 0); if (d < pd) { pd = d; pk = k; } }
        ai.wander += (Math.random() - 0.5) * 0.4;
        want = pk ? Math.atan2(pk.y - b.y, pk.x - b.x) : ai.wander;
        if (pk && Math.hypot(pk.x - b.x, pk.y - b.y) < 60) this.grant(b, pk, now);
      }
      // Under fire: weave so the shooter can't settle.
      if (threat && threat !== tg) want += Math.sin(now / 210 + b.id * 1.7) * 0.9;
      // Keep a little space from other pilots.
      for (const o of pilots) {
        if (o === b || o === tg || !o.alive) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d < 80) { want += wrap(Math.atan2(b.y - o.y, b.x - o.x) - want) * 0.35; break; }
      }
      if (Math.hypot(b.x, b.y) > ARENA_R - 180) want = Math.atan2(-b.y, -b.x);
      for (const [id, mine] of s.mines) {
        if (mine.o !== b.id && Math.hypot(mine.x - b.x, mine.y - b.y) < 36 && this.canHit(b, now) && now >= b.flareUntil) {
          s.mines.delete(id);
          this.broadcast({ t: 'mx', id });
          this.damage(b, s.pilots.get(mine.o), 'n', DAMAGE.n, now);
          if (!b.alive) break;
        }
      }
      if (!b.alive) continue;
      const turn = 3.5 * ai.skill * (b.rl ? 0.6 : 1);
      b.a = wrap(b.a + clamp(wrap(want - b.a) * 4, -turn, turn) * dt);
      const sp = 255 * (now < b.boostUntil ? 1.45 : 1) * (b.rl ? 1.25 : 1);
      b.x += Math.cos(b.a) * sp * dt; b.y += Math.sin(b.a) * sp * dt;
      b.r = clamp(wrap(want - b.a) * 0.5, -0.6, 0.6);

      // Mines go out the back when someone's on our tail.
      if (b.weapon === 'n' && threat && td < 420 && ai.fireCd <= 0) this.botFire(b, null, now);
      if (!tg) continue;
      const d = Math.hypot(tg.x - b.x, tg.y - b.y), err = Math.abs(wrap(Math.atan2(tg.y - b.y, tg.x - b.x) - b.a));
      if (d < 600 && err < 0.16 && !tg.rl) {
        const hits = Math.random() < 0.5 * ai.skill * (now < b.rapidUntil ? 1.8 : 1) * (now < b.spreadUntil ? 1.3 : 1) ? 1 : 0;
        if (hits) this.damage(tg, b, 'g', hits * (now < b.ddUntil ? 2 : 1), now);
      }
      if (ai.fireCd <= 0 && ((b.weapon === 'r' && d < 1150 && err < 0.06) || (b.weapon === 'm' && d < 950 && d > 160 && err < 0.6 && now >= tg.flareUntil))) this.botFire(b, tg, now);
    }
  }
  botEmote(b, e, now) {
    if (now - (b.emT || 0) < 4000) return;
    b.emT = now;
    setTimeout(() => { if (this.s && this.s.pilots.get(b.id) === b) this.broadcast({ t: 'em', o: b.id, e }); }, 500 + Math.random() * 900);
  }
  // A bot uses the weapon it carries. Everyone sees the shot; hits on people are still judged
  // by their own game (missiles) or right here (rail, and anything aimed at another bot).
  botFire(b, tg, now) {
    const s = this.s, w = b.weapon;
    if (!w || b.ammo <= 0) return;
    b.ammo--; if (b.ammo <= 0) b.weapon = null;
    b.ai.fireCd = w === 'r' ? 1.3 : w === 'm' ? 1.6 : 1.1;
    if (w === 'n') {
      const id = s.nextMine++, x = b.x - Math.cos(b.a) * 30, y = b.y - Math.sin(b.a) * 30;
      s.mines.set(id, { id, x, y, o: b.id, until: now + 25000 });
      this.broadcast({ t: 'f', o: b.id, w: 'n', x: Math.round(x), y: Math.round(y), id });
      return;
    }
    const ref = s.nextRef = (s.nextRef || 1e9) + 1;
    s.fired.set(ref, { o: b.id, w, tg: tg.id, at: now, hit: new Set() });
    this.broadcast({ t: 'f', o: b.id, w, x: Math.round(b.x), y: Math.round(b.y), a: Math.round(b.a * 100), tg: tg.id, ref });
    if (w === 'r') {
      if (!tg.rl && Math.random() < 0.55 + 0.3 * b.ai.skill) { s.fired.get(ref).hit.add(tg.id); this.damage(tg, b, 'r', DAMAGE.r * (now < b.ddUntil ? 2 : 1), now); }
    } else if (tg.bot) {
      (s.botShots || (s.botShots = [])).push({ at: now + Math.hypot(tg.x - b.x, tg.y - b.y) / 380 * 1000, ref, tg: tg.id, by: b.id });
    }
  }
  // Wingman drones: a few quick shots at whoever comes near their owner.
  droneTick(dt, now) {
    const s = this.s;
    for (const p of s.pilots.values()) {
      if (!p.alive || now >= p.droneUntil) continue;
      p.droneT -= dt;
      if (p.droneT > 0) continue;
      p.droneT = DRONE_EVERY;
      let tg = null, bd = DRONE_RANGE;
      for (const o of s.pilots.values()) {
        if (o === p || !o.alive || now < o.protUntil || now < o.cloakUntil) continue;
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bd) { bd = d; tg = o; }
      }
      if (!tg) continue;
      const hit = !tg.rl && Math.random() < 0.6;
      this.broadcast({ t: 'df', o: p.id, v: tg.id, x: Math.round(tg.x), y: Math.round(tg.y), h: hit ? 1 : 0 });
      if (hit) this.damage(tg, p, 'd', 1, now);
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
      if (typeof b.name === 'string' && /^pub-\d{1,3}$/.test(b.name)) {
        a[b.name] = { h: Number(b.humans) || 0, t: now, res: 0, bots: Number(b.bots) || 0, theme: THEMES.includes(b.theme) ? b.theme : null, round: Number(b.round) || 1, phase: b.phase === 'end' ? 'end' : 'play', ends: Number(b.ends) || 0, names: Array.isArray(b.names) ? b.names.slice(0, 4).map(String) : [] };
        await this.ctx.storage.put('arenas', a);
      }
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
