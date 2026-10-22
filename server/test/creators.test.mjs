import test from 'node:test';
import assert from 'node:assert/strict';
import { isCreator } from '../creators.js';

test('the creator badge goes by account username, any case', () => {
  assert.equal(isCreator('tremdog'), true);
  assert.equal(isCreator('TremDog'), true);
  assert.equal(isCreator('tremdog2'), false);
  assert.equal(isCreator(''), false);
  assert.equal(isCreator(null), false);
});
