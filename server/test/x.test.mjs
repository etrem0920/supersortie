import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { composePost, runScheduledPost, dailyInfo, postLength, slotFor } from '../x.js';
import { EPOCH_UTC } from '../day.js';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  return { raw: db, prepare(sql) { const st = db.prepare(sql); const b = a => ({ first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }); return { bind: (...a) => b(a.map(x => x === undefined ? null : x)), ...b([]) }; } };
}
const at = (day, h) => EPOCH_UTC + (day - 1) * 86400000 + h * 3600000 + 7 * 60000;

test('slots follow the UTC clock', () => {
  assert.equal(slotFor(at(10, 6)), 'recap'); assert.equal(slotFor(at(10, 14)), 'live'); assert.equal(slotFor(at(10, 22)), 'board');
});

test('daily info matches the game seeding', () => {
  // Sortie #1 (2026-04-20) as the game builds it
  const i = dailyInfo(1); assert.ok(i.ace && i.modName);
  assert.deepEqual(dailyInfo(77), dailyInfo(77));
});

test('posts carry real data, name only registered pilots, and fit in a post', async () => {
  const DB = fakeD1(), d = 50;
  DB.raw.exec(`INSERT INTO accounts (id, username, pass_hash, salt, created_at, updated_at) VALUES (1, 'tremdog', 'x', 'y', 0, 0)`);
  DB.raw.exec(`INSERT INTO scores (day, device_id, name, score, grades, time_s, theme, hp, kills, mod, created_at, account_id) VALUES (${d - 1}, 'dev-1', 'tremdog', 41000, 'gggyg', 120, 'ww2', 3, 40, 'standard', 0, 1), (${d - 1}, 'dev-2', 'Rude Guest', 52000, 'ggggg', 110, 'neon', 3, 44, 'standard', 0, NULL), (${d}, 'dev-1', 'tremdog', 39000, 'ggyyg', 120, 'ww1', 3, 40, 'standard', 0, 1), (${d}, 'dev-3', 'x', 12000, 'gyonn', 90, 'ww1', 0, 10, 'standard', 0, NULL)`);
  const env = { DB };
  const recap = await composePost(env, 'recap', at(d, 6));
  assert.match(recap.text, new RegExp(`Sortie #${d - 1} is in the books`)); assert.match(recap.text, /2 pilots/); assert.match(recap.text, /Top score: 52,000/); assert.doesNotMatch(recap.text, /Rude Guest/);
  const live = await composePost(env, 'live', at(d, 14));
  assert.match(live.text, new RegExp(dailyInfo(d).ace)); assert.match(live.text, /supersortie\.io/);
  const board = await composePost(env, 'board', at(d, 22));
  assert.match(board.text, /tremdog leads with 39,000/);
  for (const p of [recap, live, board]) assert.ok(postLength(p.text) <= 280, p.text);
  assert.doesNotMatch(recap.text, /supersortie\.io/); assert.doesNotMatch(board.text, /supersortie\.io/); assert.match(board.text, /link in bio/);
  assert.match((await composePost({ DB, X_LINK_SLOTS: 'live,board' }, 'board', at(d, 22))).text, /supersortie\.io/);
  const texts = new Set(); for (let k = 0; k < 9; k++) texts.add((await composePost(env, 'live', at(d + k, 14))).text); assert.equal(texts.size, 9);
});

test('drafts without keys, posts once per slot with keys, signs with OAuth 1.0a', async () => {
  const DB = fakeD1(), now = at(60, 14);
  const draft = await runScheduledPost({ DB }, now);
  assert.equal(draft.draft, true);
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ data: { id: '123' } }), { status: 201 }); };
  const env = { DB, X_POSTING: 'on', X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 't', X_ACCESS_SECRET: 'a' };
  const r = await runScheduledPost(env, now, fetcher);
  assert.equal(r.ok, true); assert.equal(r.id, '123'); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.twitter.com/2/tweets');
  assert.match(calls[0].init.headers.authorization, /^OAuth .*oauth_signature="[^"]+".*oauth_signature_method="HMAC-SHA1"/);
  assert.equal(JSON.parse(calls[0].init.body).text, r.text);
  const again = await runScheduledPost(env, now + 60000, fetcher);
  assert.equal(again.skipped, 'already posted'); assert.equal(calls.length, 1);
  const failing = async () => new Response(JSON.stringify({ title: 'Forbidden' }), { status: 403 });
  const f = await runScheduledPost(env, at(60, 22), failing);
  assert.equal(f.ok, false); assert.equal((await DB.prepare("SELECT status FROM x_posts WHERE slot_key = '60-board'").first()).status, 'failed');
});

test('drafts endpoint serves all three posts with the link', async () => {
  const { default: worker } = await import('../worker.js');
  const DB = fakeD1();
  const r = await worker.fetch(new Request('https://x/api/v1/x/drafts'), { DB }, {});
  const b = await r.json();
  assert.equal(b.posts.length, 3); for (const p of b.posts) assert.match(p.text, /supersortie\.io/);
  const t = await (await worker.fetch(new Request('https://x/api/v1/x/drafts?format=text'), { DB }, {})).text();
  assert.match(t, /----- Midday: today's sortie -----/);
});
