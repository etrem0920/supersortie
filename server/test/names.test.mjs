import test from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, reservedName } from '../names.js';

test('lookalike names fold to the same key', () => {
  for (const n of ['tremdog', 'TremDog', 'trem_dog', 'tremd0g', 'TREMD0G_']) assert.equal(nameKey(n), 'tremdog');
  assert.equal(nameKey('Bill'), nameKey('B1ll'));
  assert.notEqual(nameKey('tremdog'), nameKey('tremdogs'));
});
test('reserved names', () => {
  for (const n of ['admin', 'Admin_1', 'ADM1N', 'moderator', 'SuperSortie', 'support 2']) assert.equal(reservedName(n), true, n);
  for (const n of ['falcon', 'modern', 'adminton']) assert.equal(reservedName(n), false, n);
});
