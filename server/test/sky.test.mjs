import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { serverDay } from '../worker.js';
import { thinGhost, SKY_BYTES } from '../sky.js';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
  return { prepare(sql) { const st = db.prepare(sql); const b = a => ({ first: async () => st.get(...a) ?? null, all: async () => ({ results: st.all(...a) }), run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }) }); return { bind: (...a) => b(a.map(x => x === undefined ? null : x)), ...b([]) }; } };
}
const day = serverDay();
// 120 s of flight, sampled every 0.2 s: x = i, y = -i, score climbing to the posted score
const ghost = (score, n = 600) => { const u = new Uint8Array(n * 8), dv = new DataView(u.buffer); for (let i = 0; i < n; i++) { dv.setInt16(i * 8, i, true); dv.setInt16(i * 8 + 2, -i, true); dv.setInt8(i * 8 + 4, 64); dv.setUint8(i * 8 + 5, i === n - 1 ? 2 : 0); dv.setUint16(i * 8 + 6, Math.floor(score * i / n / 5), true); } return Buffer.from(u).toString('base64'); };
const call = (env, path, init) => worker.fetch(new Request('https://x' + path, init), env, { waitUntil() {} });
const score = (env, dev, name, sc, ip) => call(env, '/api/v1/scores', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ day, deviceId: dev, name, score: sc, grades: 'ggyyo', time: 120, theme: 'ww2', hp: 2, kills: 30, mod: 'standard', waveTimes: [12, 18, 25, 30, 35], plane: 'hellcat', livery: 3 }) });
const parse = async r => { const buf = new Uint8Array(await r.arrayBuffer()), n = new DataView(buf.buffer).getUint32(0, true); return { meta: JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + n))), body: buf.subarray(4 + n) }; };

test('thinning keeps every other sample, minus the score', () => {
  const t = thinGhost(ghost(5000));
  assert.equal(t.length, 300 * SKY_BYTES);
  const dv = new DataView(t.buffer);
  assert.equal(dv.getInt16(SKY_BYTES, true), 2); assert.equal(dv.getInt16(SKY_BYTES + 2, true), -2); assert.equal(dv.getInt8(SKY_BYTES + 4), 64);
});

test('the sky is the day\'s top 25 runs, best first', async () => {
  const env = { DB: fakeD1(), IP_SALT: 's', ADMIN_TOKEN: 't' };
  for (let k = 0; k < 30; k++) {
    const dev = `device-sky-${String(k).padStart(4, '0')}`;
    assert.equal((await score(env, dev, `Pilot ${k}`, 9000 + k * 100, `9.9.${k}.1`)).status, 201);
    const g = await call(env, '/api/v1/ghost', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day, deviceId: dev, data: ghost(9000 + k * 100) }) });
    assert.ok(g.ok, 'ghost accepted');
  }
  const { meta, body } = await parse(await call(env, `/api/v1/sky?day=${day}&d=device-sky-0029`));
  assert.equal(meta.ghosts.length, 25); assert.equal(meta.dt, 0.4);
  assert.deepEqual(meta.ghosts.map(g => g.r), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal(body.length, meta.ghosts.reduce((s, g) => s + g.n * SKY_BYTES, 0));
  assert.equal(meta.ghosts[0].me, 1, 'the best run, marked as yours');
  assert.ok(meta.ghosts.every(g => g.p === 'hellcat' && g.l === 3 && !g.u), 'guest names are not sent');
  assert.equal((await call(env, '/api/v1/sky?day=abc')).status, 400);
});
