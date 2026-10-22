import test from 'node:test';
import assert from 'node:assert/strict';
import { serverDay, localDay, clientDay, EPOCH_UTC } from '../day.js';

test('local day follows the pilot\'s midnight, not UTC', () => {
  const lateEveningPT = Date.UTC(2026, 9, 23, 3, 0); // Oct 22, 8pm PDT = Oct 23 03:00 UTC
  assert.equal(serverDay(lateEveningPT), localDay(lateEveningPT, 0));
  assert.equal(localDay(lateEveningPT, 420), serverDay(lateEveningPT) - 1);
  assert.equal(localDay(Date.UTC(2026, 9, 22, 20, 0), -600), serverDay(Date.UTC(2026, 9, 22, 20, 0)) + 1); // Sydney is already tomorrow
  assert.equal(localDay(EPOCH_UTC + 3600000, 0), 1);
});
test('bad offsets fall back to the server day', () => {
  const now = Date.now();
  assert.equal(localDay(now, 5000), serverDay(now));
  assert.equal(localDay(now, NaN), serverDay(now));
});
test('clients can only ask for a day some timezone is on', () => {
  const sd = serverDay();
  assert.equal(clientDay(sd - 1), sd - 1);
  assert.equal(clientDay(sd + 1), sd + 1);
  assert.equal(clientDay(sd - 5), sd);
  assert.equal(clientDay('x'), sd);
});
