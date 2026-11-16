import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanChat, CHAT_MAX } from '../chat.js';

const ok = s => { const r = cleanChat(s); assert.ok(r.ok, `${s} -> ${r.why}`); return r.text; };
const no = (s, why) => { const r = cleanChat(s); assert.equal(r.ok, false, s); if (why) assert.equal(r.why, why, s); };

test('ordinary chat goes through untouched, plane talk included', () => {
  for (const s of ['gg everyone', 'that ace in wave 5 is brutal', 'cockpit view would be sick', 'anyone from Nigeria?', 'draping the flag', 'class act', 'Scunthorpe pilot here', 'assassin run 28k']) assert.equal(ok(s), s);
});
test('whitespace and invisible characters are tidied', () => {
  assert.equal(ok('  hi   there ​ '), 'hi there');
  no('   ', 'empty');
  no('x'.repeat(CHAT_MAX + 1), 'too_long');
});
test('swearing is masked, leetspeak and stretching included', () => {
  assert.equal(ok('what the fuck'), 'what the f***');
  assert.equal(ok('sh1t'), 's***');
  assert.equal(ok('FUUUCK'), 'F*****');
  assert.equal(ok('what an asshole'), 'what an a******');
});
test('slurs and threats are refused, even spaced out or disguised', () => {
  no('kys', 'not_allowed');
  no('n i g g a', 'not_allowed');
  no('f4gg0t', 'not_allowed');
  no('kill   your self', 'not_allowed');
});
test('links are refused', () => {
  for (const s of ['go to https://evil.example', 'www.free-credits.com', 'join discord.gg/abc', 'mysite.io lol']) no(s, 'no_links');
  assert.equal(ok('supersortie is fun'), 'supersortie is fun');
});

// The room itself, on a stand-in for the Durable Object runtime.
import { ChatRoom } from '../chat.js';
function room() {
  const store = new Map(), sockets = [];
  const ctx = { storage: { get: async k => store.get(k), put: async (k, v) => { if (typeof k === 'object') for (const [a, b] of Object.entries(k)) store.set(a, b); else store.set(k, v); } }, getWebSockets: () => sockets };
  const r = new ChatRoom(ctx, {});
  const join = (u, cr) => { const ws = { att: { u, cr: !!cr, last: 0, burst: [], prev: '' }, got: [], send(s) { this.got.push(JSON.parse(s)); }, serializeAttachment(a) { this.att = a; }, deserializeAttachment() { return this.att; } }; sockets.push(ws); return ws; };
  const say = (ws, text) => r.webSocketMessage(ws, JSON.stringify({ t: 'say', text }));
  return { r, store, join, say };
}
test('signed-in pilots post, guests only read, everyone hears it', async () => {
  const { r, join, say } = room(), a = join('tremdog', true), b = join('ace_pilot'), g = join(null);
  await say(b, 'hello hangar');
  assert.equal(g.got.at(-1).msg.text, 'hello hangar'); assert.equal(a.got.at(-1).msg.u, 'ace_pilot');
  await say(g, 'can I talk?');
  assert.equal(g.got.at(-1).why, 'sign_in');
  assert.equal(r.msgs.length, 1);
});
test('slow mode, repeats and bad messages are turned away', async () => {
  const { r, join, say } = room(), b = join('ace_pilot');
  await say(b, 'one'); await say(b, 'two');
  assert.equal(b.got.at(-1).why, 'slow');
  b.att.last = 0; await say(b, 'one');
  assert.equal(b.got.at(-1).why, 'repeat');
  b.att.last = 0; await say(b, 'visit www.scam.com');
  assert.equal(b.got.at(-1).why, 'no_links');
  assert.equal(r.msgs.length, 1);
});
test('only the creator can delete messages and mute pilots', async () => {
  const { r, join, say, store } = room(), c = join('tremdog', true), b = join('ace_pilot'), x = join('troll_99');
  await say(x, 'spam spam');
  const id = r.msgs[0].id;
  await r.webSocketMessage(b, JSON.stringify({ t: 'del', id }));
  assert.equal(r.msgs.length, 1, 'a normal pilot cannot delete');
  await r.webSocketMessage(c, JSON.stringify({ t: 'del', id }));
  assert.equal(r.msgs.length, 0); assert.equal(b.got.at(-1).t, 'del');
  x.att.last = 0; await say(x, 'more spam');
  await r.webSocketMessage(c, JSON.stringify({ t: 'mute', u: 'troll_99' }));
  assert.equal(r.msgs.length, 0, 'their messages go'); assert.ok(store.get('mutes').troll_99 > Date.now());
  x.att.last = 0; await say(x, 'am I muted');
  assert.equal(x.got.at(-1).why, 'muted');
});
test('history keeps the last 50', async () => {
  const { r, join, say } = room(), b = join('ace_pilot');
  for (let i = 0; i < 60; i++) { b.att.last = 0; b.att.burst = []; await say(b, 'msg ' + i); }
  assert.equal(r.msgs.length, 50); assert.equal(r.msgs[0].text, 'msg 10');
});
