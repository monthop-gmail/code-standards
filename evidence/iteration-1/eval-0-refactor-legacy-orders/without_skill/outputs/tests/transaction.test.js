'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { withTransaction } = require('../src/db/transaction');

function fakePool() {
  const log = [];
  const connection = {
    beginTransaction: async () => log.push('begin'),
    commit: async () => log.push('commit'),
    rollback: async () => log.push('rollback'),
    release: () => log.push('release'),
  };
  return { pool: { getConnection: async () => connection }, log };
}

test('commits and always releases the connection on success', async () => {
  const { pool, log } = fakePool();
  const result = await withTransaction(pool, async () => 'value');

  assert.equal(result, 'value');
  assert.deepEqual(log, ['begin', 'commit', 'release']);
});

test('rolls back, releases, and rethrows on failure', async () => {
  const { pool, log } = fakePool();

  await assert.rejects(
    withTransaction(pool, async () => { throw new Error('boom'); }),
    /boom/,
  );
  assert.deepEqual(log, ['begin', 'rollback', 'release']);
});

test('a failing rollback does not mask the original error', async () => {
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => { throw new Error('rollback failed'); },
    release: () => {},
  };

  await assert.rejects(
    withTransaction({ getConnection: async () => connection }, async () => {
      throw new Error('original failure');
    }),
    /original failure/,
  );
});
