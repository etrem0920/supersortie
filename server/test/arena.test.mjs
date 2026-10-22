import test from 'node:test';
import assert from 'node:assert/strict';
import { assignArena, killPoints, pickKind, PICKUPS, cleanName, ARENA_MAX } from '../arena.js';

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
