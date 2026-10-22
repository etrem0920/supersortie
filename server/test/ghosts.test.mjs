import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGhost } from '../ghosts.js';

const make = (n, scoreAt) => {
  const u = new Uint8Array(n * 8), dv = new DataView(u.buffer);
  for (let i = 0; i < n; i++) { dv.setInt16(i * 8, i, true); dv.setUint16(i * 8 + 6, Math.floor(scoreAt(i) / 5), true); }
  return Buffer.from(u).toString('base64');
};

test('accepts a ghost that matches the scored run', () => {
  assert.equal(checkGhost(make(600, i => i * 10), 120, 6000), 600);
});
test('rejects a ghost whose length does not match the flight time', () => {
  assert.equal(checkGhost(make(200, i => i), 120, 6000), 0);
});
test('rejects a score that goes down or ends above the posted score', () => {
  assert.equal(checkGhost(make(600, i => (i === 300 ? 0 : i * 10)), 120, 6000), 0);
  assert.equal(checkGhost(make(600, i => i * 20), 120, 6000), 0);
});
test('rejects junk', () => {
  assert.equal(checkGhost('not base64!', 120, 6000), 0);
  assert.equal(checkGhost(12, 120, 6000), 0);
  assert.equal(checkGhost('A'.repeat(40000), 120, 6000), 0);
});
