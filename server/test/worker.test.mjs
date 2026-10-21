// Runs the real Worker against a SQLite-backed stand-in for D1: `node --test server/test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { serverDay, validate } from '../worker.js';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = args => ({
        first: async () => stmt.get(...args) ?? null,
        all: async () => ({ results: stmt.all(...args) }),
        run: async () => { const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } }; },
      });
      return { bind: (...args) => bound(args.map(a => (a === undefined ? null : a))), ...bound([]) };
    },
  };
}
const env = () => ({ DB: fakeD1(), ADMIN_TOKEN: 'secret-token', IP_SALT: 'salt' });
const day = serverDay();
const good = (o = {}) => Object.assign({ day, deviceId: 'device-aaaa-0001', name: 'Viper 12', score: 18000, grades: 'ggyyo', time: 140, theme: 'ww2', hp: 2, kills: 30, mod: 'standard', waveTimes: [12, 18, 25, 30, 40] }, o);
const post = (e, body, ip = '1.2.3.4') => worker.fetch(new Request('https://x/api/v1/scores', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) }), e, {});
const board = (e, q) => worker.fetch(new Request(`https://x/api/v1/leaderboard?${q}`), e, {});

test('accepts a valid score once per device per day', async () => {
  const e = env();
  const r1 = await post(e, good());
  assert.equal(r1.status, 201);
  assert.deepEqual(await r1.json(), { ok: true, rank: 1, total: 1 });
  assert.equal((await post(e, good({ score: 30000 }))).status, 409);
});

test('ranks players and reports the caller', async () => {
  const e = env();
  await post(e, good({ deviceId: 'device-aaaa-0001', score: 12000, name: 'Alpha' }));
  await post(e, good({ deviceId: 'device-aaaa-0002', score: 20000, name: 'Bravo' }));
  await post(e, good({ deviceId: 'device-aaaa-0003', score: 20000, name: 'Charlie', time: 130 }));
  const b = await (await board(e, `day=${day}&deviceId=device-aaaa-0001`)).json();
  assert.equal(b.total, 3);
  assert.deepEqual(b.entries.map(x => [x.rank, x.name]), [[1, 'Charlie'], [1, 'Bravo'], [3, 'Alpha']]);
  assert.equal(b.me.rank, 3);
  assert.equal(b.entries[2].me, true);
  assert.ok(!JSON.stringify(b).includes('device-aaaa-0002'), 'device ids are never exposed');
});

test('rejects implausible or malformed results', () => {
  assert.equal(validate(good({ score: 59000, kills: 3 })).error, 'implausible');
  assert.equal(validate(good({ grades: 'gxgyy' })).error, 'bad_grades');
  assert.equal(validate(good({ waveTimes: [1, 1, 1, 1, 1] })).error, 'bad_wave_times');
  assert.equal(validate(good({ day: day + 5 })).error, 'day_out_of_range');
  assert.equal(validate(good({ theme: 'mars' })).error, 'bad_theme');
  assert.equal(validate(good({ grades: 'ggxnn', waveTimes: [10, 12] })).entry.grades, 'ggxnn');
  assert.equal(validate(good({ name: 'fuck you' })).entry.name, 'Pilot');
});

test('rate limits a single IP', async () => {
  const e = env();
  let last;
  for (let i = 0; i < 32; i++) last = await post(e, good({ deviceId: `device-rate-${String(i).padStart(4, '0')}` }), '9.9.9.9');
  assert.equal(last.status, 429);
});

test('admin can hide a score; others cannot', async () => {
  const e = env();
  await post(e, good());
  const del = (auth) => worker.fetch(new Request(`https://x/api/v1/admin/scores?day=${day}&deviceId=device-aaaa-0001`, { method: 'DELETE', headers: auth ? { authorization: auth } : {} }), e, {});
  assert.equal((await del('Bearer wrong')).status, 401);
  assert.equal((await del('Bearer secret-token')).status, 200);
  assert.equal((await (await board(e, `day=${day}`)).json()).total, 0);
});

test('allows each listed site and no others', async () => {
  const e = Object.assign(env(), { ALLOWED_ORIGIN: 'https://supersortie.io, https://www.supersortie.io' });
  const from = async origin => (await worker.fetch(new Request('https://x/api/v1/health', { headers: { origin } }), e, {})).headers.get('access-control-allow-origin');
  assert.equal(await from('https://supersortie.io'), 'https://supersortie.io');
  assert.equal(await from('https://www.supersortie.io'), 'https://www.supersortie.io');
  assert.equal(await from('https://evil.example'), 'https://supersortie.io');
});
