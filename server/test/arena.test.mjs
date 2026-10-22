import test from 'node:test';
import assert from 'node:assert/strict';
import { assignArena, killPoints, pickKind, PICKUPS, cleanName, ARENA_MAX, parseRules } from '../arena.js';

test('quick play fills the busiest arena that still has room', () => {
  const now = Date.now();
  assert.equal(assignArena({}, now), 'pub-1');
  assert.equal(assignArena({ 'pub-1': { h: 4, t: now } }, now), 'pub-1');
  assert.equal(assignArena({ 'pub-1': { h: 3, t: now }, 'pub-2': { h: 7, t: now } }, now), 'pub-2');
  assert.equal(assignArena({ 'pub-1': { h: ARENA_MAX - 1, t: now } }, now), 'pub-2');
  // pilots just sent somewhere count until the arena reports back
  assert.equal(assignArena({ 'pub-1': { h: 9, t: now, res: 3, resT: now } }, now), 'pub-2');
  // an arena that stopped reporting is treated as empty
  assert.equal(assignArena({ 'pub-1': { h: 11, t: now - 200000 } }, now), 'pub-1');
});

test('kill points reward streaks and shutting down streaks', () => {
  assert.equal(killPoints(1, 0), 100);
  assert.equal(killPoints(3, 0), 150);
  assert.equal(killPoints(20, 0), 300);
  assert.equal(killPoints(1, 2), 100);
  assert.equal(killPoints(1, 5), 350);
});

test('every power-up can drop, except Overdrive which only bosses drop', () => {
  const total = Object.values(PICKUPS).reduce((s, p) => s + p.weight, 0);
  const seen = new Set();
  let acc = 0;
  for (const [k, p] of Object.entries(PICKUPS)) { if (p.weight) seen.add(pickKind((acc + p.weight / 2) / total)); acc += p.weight; }
  assert.equal(seen.size, Object.keys(PICKUPS).length - 1);
  assert.ok(!seen.has('o'));
  for (let i = 0; i < 2000; i++) assert.notEqual(pickKind(), 'o');
});

test('arena callsigns are cleaned', () => {
  assert.equal(cleanName('  Red <b>Baron</b> '), 'Red bBaronb');
  assert.equal(cleanName(''), 'Pilot');
});

test('private arena rules are clamped to what the game supports', () => {
  const q = o => new URLSearchParams(o);
  assert.deepEqual(parseRules(q({})), { max: ARENA_MAX, round: 0, boss: 'normal', pu: null });
  assert.equal(parseRules(q({ max: '1' })).max, 2);
  assert.equal(parseRules(q({ max: '99' })).max, 15);
  assert.equal(parseRules(q({ round: '5' })).round, 0);
  assert.equal(parseRules(q({ round: '8' })).round, 8);
  assert.equal(parseRules(q({ boss: 'fast' })).boss, 'fast');
  assert.equal(parseRules(q({ boss: 'lots' })).boss, 'normal');
  assert.deepEqual(parseRules(q({ pu: 'm,r,zz,o' })).pu, ['m', 'r']);
  assert.deepEqual(parseRules(q({ pu: '' })).pu, []);
});

test('power-up picks respect a private arena\'s list', () => {
  for (let i = 0; i < 500; i++) assert.ok(['m', 'z'].includes(pickKind(Math.random(), ['m', 'z'])));
  assert.equal(pickKind(0.5, []), null);
});

test('AI pilots wear a random loadout, never the Elite, season or Apex items', async () => {
  const { botLook, PLANES_PER_THEATER, LIVERIES, TRAILS, BULLETS, KILLFX } = await import('../arena.js');
  const seen = { livery: new Set(), trail: new Set(), bullet: new Set(), kfx: new Set(), plane: new Set() };
  for (let i = 0; i < 4000; i++) { const l = botLook(); for (const k of Object.keys(seen)) seen[k].add(l[k]); }
  assert.ok(!seen.livery.has(12) && !seen.livery.has(LIVERIES - 1) && seen.livery.size > 120, 'skins');
  assert.ok(!seen.trail.has(20) && !seen.trail.has(TRAILS - 1) && seen.trail.size === TRAILS - 6, 'contrails');
  assert.ok(!seen.bullet.has(BULLETS - 1) && seen.bullet.size === BULLETS - 5, 'bullets');
  assert.ok(!seen.kfx.has(KILLFX - 1) && seen.kfx.size === KILLFX - 5, 'kill effects');
  assert.ok(!seen.plane.has(PLANES_PER_THEATER - 1) && seen.plane.size === PLANES_PER_THEATER - 1, 'planes');
});
