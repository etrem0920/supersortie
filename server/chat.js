// Hangar chat: one live room for every pilot (a Durable Object with hibernating WebSockets).
// Anyone can read; only signed-in pilots can post, under their account name. The Worker vouches
// for who is connecting (see chatSocket in worker.js); this room never trusts the client for that.
// Rules: no links, swearing masked, slurs and threats refused, slow mode, no repeats, 200 characters.
// The game's creator can delete any message and mute a pilot.

export const CHAT_MAX = 200, CHAT_KEEP = 50, CHAT_GAP_MS = 2500, CHAT_BURST = 6, CHAT_BURST_MS = 30000;

// Folds leetspeak and padding so "sh1t", "s.h.i.t" and "SHIIIT" all read the same.
const FOLD = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g', '|': 'i' };
const fold = w => w.toLowerCase().split('').map(ch => FOLD[ch] || ch).join('').replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
// Word lists are written folded (double letters collapsed): "asshole" is "ashole".
// Whole words, masked with stars.
const MASK_WORD = new Set(['fuk', 'fck', 'fk', 'dick', 'dicks', 'cock', 'cocks', 'pusy', 'cunt', 'cunts', 'bastard', 'slut', 'sluts', 'wanker', 'twat', 'bolocks', 'dildo', 'porn', 'sex', 'nude', 'nudes', 'tits', 'bobs', 'penis', 'vagina']);
// Anywhere inside a word, masked with stars (none of these hide in ordinary words like "cockpit").
const MASK_PART = ['fuck', 'shit', 'bitch', 'ashole', 'whore', 'motherfuck'];
// Never posted at all: whole words, and parts that can't be innocent (checked with spaces squeezed out too).
const REFUSE_WORD = new Set(['niger', 'fag', 'fags', 'retard', 'retarded', 'kys', 'rape', 'raped', 'raping', 'trany', 'chink', 'spic', 'kike', 'hitler', 'nazi', 'nazis']);
const REFUSE_PART = ['niga', 'nigr', 'fagot', 'kilyourself'];
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|gg|ly|co|me|tv|xyz|app|dev|link|site|info|ru|cn|uk|us|to|be)\b|discord\s*\.?\s*gg)/i;

// Returns { ok, text } or { ok: false, why }.
export function cleanChat(raw) {
  let text = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, why: 'empty' };
  if (text.length > CHAT_MAX) return { ok: false, why: 'too_long' };
  if (LINK.test(text)) return { ok: false, why: 'no_links' };
  const words = text.split(' '), squashed = fold(text);
  if (REFUSE_PART.some(r => squashed.includes(r)) || words.some(w => REFUSE_WORD.has(fold(w)))) return { ok: false, why: 'not_allowed' };
  text = words.map(w => { const f = fold(w); return MASK_WORD.has(f) || MASK_PART.some(m => f.includes(m)) ? w[0] + '*'.repeat(Math.max(2, w.length - 1)) : w; }).join(' ');
  return { ok: true, text };
}

const json = (o) => JSON.stringify(o);

export class ChatRoom {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.msgs = null; this.mutes = null; }
  async load() {
    if (this.msgs) return;
    this.msgs = (await this.ctx.storage.get('msgs')) || [];
    this.mutes = (await this.ctx.storage.get('mutes')) || {};
  }
  online() { return this.ctx.getWebSockets().length; }
  broadcast(o) { const s = json(o); for (const ws of this.ctx.getWebSockets()) { try { ws.send(s); } catch (e) { /* closing */ } } }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    await this.load();
    const url = new URL(req.url);
    const u = /^[A-Za-z0-9_]{3,16}$/.test(url.searchParams.get('u') || '') ? url.searchParams.get('u') : null;
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ u, cr: !!u && url.searchParams.get('cr') === '1', last: 0, burst: [], prev: '' });
    server.send(json({ t: 'hist', msgs: this.msgs, online: this.online(), you: u, cr: !!u && url.searchParams.get('cr') === '1' }));
    this.broadcast({ t: 'online', n: this.online() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 2000) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    await this.load();
    const me = ws.deserializeAttachment() || {};
    const now = Date.now();
    const no = why => ws.send(json({ t: 'no', why }));
    if (m.t === 'say') {
      if (!me.u) return no('sign_in');
      const until = this.mutes[me.u.toLowerCase()] || 0;
      if (until > now) return no('muted');
      if (now - me.last < CHAT_GAP_MS) return no('slow');
      me.burst = (me.burst || []).filter(t => now - t < CHAT_BURST_MS);
      if (me.burst.length >= CHAT_BURST) return no('slow');
      const c = cleanChat(m.text);
      if (!c.ok) return no(c.why);
      if (c.text.toLowerCase() === me.prev) return no('repeat');
      me.last = now; me.burst.push(now); me.prev = c.text.toLowerCase();
      ws.serializeAttachment(me);
      const msg = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), u: me.u, cr: me.cr ? 1 : 0, text: c.text, at: now };
      this.msgs.push(msg); if (this.msgs.length > CHAT_KEEP) this.msgs.splice(0, this.msgs.length - CHAT_KEEP);
      await this.ctx.storage.put('msgs', this.msgs);
      this.broadcast({ t: 'msg', msg });
      return;
    }
    // Creator moderation
    if (!me.cr) return;
    if (m.t === 'del' && typeof m.id === 'string') {
      const n = this.msgs.length; this.msgs = this.msgs.filter(x => x.id !== m.id);
      if (this.msgs.length !== n) { await this.ctx.storage.put('msgs', this.msgs); this.broadcast({ t: 'del', id: m.id }); }
    } else if (m.t === 'mute' && /^[A-Za-z0-9_]{3,16}$/.test(m.u || '')) {
      const key = m.u.toLowerCase(), mins = Math.max(1, Math.min(60 * 24 * 7, Number(m.mins) || 60 * 24));
      this.mutes[key] = now + mins * 60000;
      for (const k of Object.keys(this.mutes)) if (this.mutes[k] < now) delete this.mutes[k];
      // and their messages go with them
      this.msgs = this.msgs.filter(x => x.u.toLowerCase() !== key);
      await this.ctx.storage.put({ mutes: this.mutes, msgs: this.msgs });
      this.broadcast({ t: 'purge', u: m.u });
    }
  }
  webSocketClose() { this.broadcast({ t: 'online', n: Math.max(0, this.online() - 1) }); }
  webSocketError() { this.broadcast({ t: 'online', n: Math.max(0, this.online() - 1) }); }
}
