// Co-op rooms: one Durable Object per four-letter room code.
//
// The room keeps the lobby (players, host, settings) and relays game messages.
// The host's browser runs the enemies and waves; every player flies their own plane.
//   client -> room:  hello, me, settings, start, lobby   (lobby control, handled here)
//                    p, s, eb, kill, pk, picked, wave, end (game traffic, relayed to everyone else)
//                    h, mh, unlock, pick                   (game traffic, relayed to the host only)
//   room -> client:  room (lobby state), begin (mission start), hostleft, error,
//                    and relayed game traffic wrapped as {"f": senderId, "m": message}.

export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_PLAYERS = 4;
const THEMES = ['ww1', 'ww2', 'modern', 'space', 'neon'];
const MODS = ['random', 'standard', 'glass', 'swarm', 'ironace', 'overcast', 'crosswind', 'hotguns'];
const WAVES = [3, 5, 8, 12];
const DIFFICULTIES = ['easy', 'normal', 'hard', 'brutal'];
const HULLS = [2, 3, 5];
const HOST_ONLY = new Set(['h', 'mh', 'unlock', 'pick', 'hurt']);      // guest -> host
const FROM_HOST = new Set(['s', 'eb', 'kill', 'pk', 'picked', 'wave', 'end']); // host -> everyone
const RELAY = new Set(['p', ...FROM_HOST, ...HOST_ONLY]);
const BLOCKED = /(fuck|shit|cunt|nigg|fag|bitch|rape|nazi|hitler|kike|retard|whore|slut)/i;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

export const DEFAULT_SETTINGS = { theme: 'ww2', waves: 5, difficulty: 'normal', mod: 'standard', hull: 3, ace: true };

export function cleanName(s) {
  s = String(s || '').replace(/[^A-Za-z0-9 _.\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  if (!s || BLOCKED.test(s.replace(/[^a-z]/gi, ''))) return 'Pilot';
  return s;
}
const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
const small = (v, max) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= max ? n : 0; };

export function cleanSettings(s, prev = DEFAULT_SETTINGS) {
  s = s && typeof s === 'object' ? s : {};
  return {
    theme: pick(s.theme, THEMES, prev.theme),
    waves: pick(Number(s.waves), WAVES, prev.waves),
    difficulty: pick(s.difficulty, DIFFICULTIES, prev.difficulty),
    mod: pick(s.mod, MODS, prev.mod),
    hull: pick(Number(s.hull), HULLS, prev.hull),
    ace: typeof s.ace === 'boolean' ? s.ace : prev.ace,
  };
}

export class CoopRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.meta = null; // { phase, host, settings, seed, created }
  }

  async loadMeta() {
    if (!this.meta) this.meta = (await this.ctx.storage.get('meta')) || null;
    return this.meta;
  }
  async saveMeta() { await this.ctx.storage.put('meta', this.meta); }

  players() {
    return this.ctx.getWebSockets().map(ws => ({ ws, p: ws.deserializeAttachment() })).filter(x => x.p && x.p.id)
      .sort((a, b) => a.p.joined - b.p.joined);
  }

  roomState() {
    return {
      t: 'room', host: this.meta.host, phase: this.meta.phase, settings: this.meta.settings,
      players: this.players().map(({ p }) => ({ id: p.id, name: p.name, plane: p.plane, livery: p.livery, trail: p.trail || 0, ready: p.ready })),
    };
  }
  broadcast(obj, except) {
    const raw = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) if (ws !== except) { try { ws.send(raw); } catch (e) { /* socket closing */ } }
  }
  sendRoom() { this.broadcast(this.roomState()); }

  reject(code) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    server.send(JSON.stringify({ t: 'error', code }));
    server.close(4000, code);
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const url = new URL(req.url);
    const create = url.searchParams.get('create') === '1';
    await this.loadMeta();
    const live = this.players();

    if (create) {
      if (this.meta && live.length) return this.reject('taken');
      this.meta = { phase: 'lobby', host: null, settings: { ...DEFAULT_SETTINGS }, seed: null, created: Date.now() };
      await this.saveMeta();
    } else {
      if (!this.meta || !live.length) return this.reject('no_room');
      if (this.meta.phase === 'game') return this.reject('in_progress');
      if (live.length >= MAX_PLAYERS) return this.reject('full');
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, name: 'Pilot', plane: 0, livery: 0, ready: false, joined: Date.now() });
    if (!this.meta.host) { this.meta.host = id; await this.saveMeta(); }
    await this.ctx.storage.deleteAlarm();
    server.send(JSON.stringify({ t: 'welcome', you: id }));
    this.sendRoom();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 24000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    await this.loadMeta();
    if (!this.meta) return;
    const me = ws.deserializeAttachment();
    if (!me) return;
    const isHost = me.id === this.meta.host;

    if (RELAY.has(msg.t)) {
      if (this.meta.phase !== 'game') return;
      if (FROM_HOST.has(msg.t) && !isHost) return; // only the host runs the mission
      const out = `{"f":"${me.id}","m":${raw}}`;
      if (HOST_ONLY.has(msg.t)) {
        const host = this.players().find(x => x.p.id === this.meta.host);
        if (host && host.ws !== ws) host.ws.send(out);
      } else this.broadcast(out, ws);
      return;
    }

    switch (msg.t) {
      case 'hello':
      case 'me':
        if ('name' in msg) me.name = cleanName(msg.name);
        if ('plane' in msg) me.plane = small(msg.plane, 5);
        if ('livery' in msg) me.livery = small(msg.livery, 4);
        if ('trail' in msg) me.trail = small(msg.trail, 8);
        if ('ready' in msg) me.ready = !!msg.ready;
        ws.serializeAttachment(me);
        this.sendRoom();
        break;
      case 'settings':
        if (!isHost || this.meta.phase !== 'lobby') return;
        this.meta.settings = cleanSettings(msg.settings, this.meta.settings);
        await this.saveMeta();
        this.sendRoom();
        break;
      case 'start': {
        if (!isHost) return;
        if (this.meta.phase === 'lobby' && this.players().some(({ p }) => p.id !== this.meta.host && !p.ready)) return;
        this.meta.phase = 'game';
        this.meta.seed = `COOP-${crypto.randomUUID().slice(0, 8)}`;
        await this.saveMeta();
        const roster = this.players().map(({ p }) => ({ id: p.id, name: p.name, plane: p.plane, livery: p.livery, trail: p.trail || 0 }));
        this.broadcast({ t: 'begin', seed: this.meta.seed, settings: this.meta.settings, host: this.meta.host, players: roster });
        this.sendRoom();
        break;
      }
      case 'lobby':
        if (!isHost) return;
        this.meta.phase = 'lobby';
        await this.saveMeta();
        for (const { ws: w, p } of this.players()) { p.ready = false; w.serializeAttachment(p); }
        this.sendRoom();
        break;
      default:
        break;
    }
  }

  async leave(ws) {
    await this.loadMeta();
    if (!this.meta) return;
    const me = ws.deserializeAttachment();
    try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ }
    const rest = this.players().filter(x => x.ws !== ws);
    if (!rest.length) {
      this.meta.phase = 'lobby'; this.meta.host = null;
      await this.saveMeta();
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_TTL_MS);
      return;
    }
    if (me && me.id === this.meta.host) {
      this.meta.host = rest[0].p.id;
      if (this.meta.phase === 'game') { this.meta.phase = 'lobby'; this.broadcast({ t: 'hostleft' }, ws); }
      for (const { ws: w, p } of rest) { p.ready = false; w.serializeAttachment(p); }
    }
    await this.saveMeta();
    this.broadcast({ ...this.roomState(), players: this.roomState().players.filter(p => !me || p.id !== me.id) }, ws);
  }
  async webSocketClose(ws) { await this.leave(ws); }
  async webSocketError(ws) { await this.leave(ws); }

  async alarm() {
    if (!this.players().length) { await this.ctx.storage.deleteAll(); this.meta = null; }
  }
}
