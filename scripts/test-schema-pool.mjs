// Offline regression for the actual rawQuery function, with an adversarial pool.
// No production connections, events, credentials or writes are involved.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/lib/prisma.ts', import.meta.url), 'utf8');
// Pin the deployed baseline so this regression remains valid after committing
// the repair itself (HEAD will then contain the fixed implementation).
const deployedCommit = 'c78ff36db0c82e13c86e5073020472c6546313a3';
const original = execFileSync('git', ['show', `${deployedCommit}:src/lib/prisma.ts`], {
  encoding: 'utf8',
});

function load(text, client, schema = 'umami', replica = false) {
  const start = text.indexOf('async function rawQuery(');
  const end = text.indexOf('\nasync function pagedQuery', start);
  assert.ok(start >= 0 && end > start);
  const js = stripTypeScriptTypes(text.slice(start, end));
  const context = vm.createContext({
    client,
    getSchema: () => schema,
    process: { env: { DATABASE_REPLICA_URL: replica ? 'configured' : undefined } },
    log: () => {},
  });
  return vm.runInContext(`${js}\nrawQuery`, context);
}

function pool({ fail = false } = {}) {
  let next = 0;
  const sessions = [{ schema: 'public' }, { schema: 'public' }];
  const calls = [];
  const get = () => sessions[next++ % sessions.length];
  const query = async (session, sql, params) => {
    calls.push({ sql, params, session });
    if (sql === "SELECT set_config('search_path', $1, true)") {
      session.schema = params[0];
      return [{ set_config: params[0] }];
    }
    if (fail) throw new Error('query_failure');
    if (sql.includes('website_event') && session.schema !== '"umami"') {
      throw new Error('42P01');
    }
    return [{ count: 30 }];
  };
  const client = {
    async $executeRawUnsafe(sql) {
      const session = get();
      calls.push({ sql, params: [], session });
      session.schema = '"umami"';
    },
    $queryRawUnsafe(sql, ...params) {
      // Prisma queries are lazy thenables; $transaction binds their execution.
      return {
        run: session => query(session, sql, params),
        then: (resolve, reject) => query(get(), sql, params).then(resolve, reject),
      };
    },
    async $transaction(operations) {
      const session = get();
      const saved = session.schema;
      calls.push({ transaction: 'begin', session });
      try {
        const result = [];
        for (const operation of operations) result.push(await operation.run(session));
        calls.push({ transaction: 'commit', session });
        return result;
      } catch (error) {
        calls.push({ transaction: 'rollback', session });
        throw error;
      } finally {
        session.schema = saved;
      }
    },
  };
  return { client, calls, sessions };
}

test('deployed separate SET reproduces missing-table error when pool rotates', async () => {
  const p = pool();
  await assert.rejects(
    load(original, p.client)('select count(*) from website_event', {}),
    /42P01/,
  );
});
test('fixed query pins schema and report query to one connection', async () => {
  const p = pool();
  const run = load(source, p.client);
  for (let i = 0; i < 12; i++) {
    const result = await run(
      'select count(*) from website_event where website_id={{id::uuid}}',
      { id: 'fixture' },
    );
    assert.equal(result[0].count, 30);
  }
  assert.equal(p.calls.filter(c => c.transaction === 'commit').length, 12);
  assert.ok(p.sessions.every(s => s.schema === 'public'));
  for (let i = 0; i < p.calls.length; i += 4) {
    assert.equal(p.calls[i + 1].session, p.calls[i + 2].session);
    assert.equal(p.calls[i + 2].sql, 'select count(*) from website_event where website_id=$1::uuid');
    assert.equal(p.calls[i + 2].params[0], 'fixture');
  }
});
test('default-schema path needs no transaction or SET', async () => {
  const p = pool();
  await load(source, p.client, null)('select 1', {});
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].sql, 'select 1');
});
test('replica selection applies to both schema and report query', async () => {
  const primary = pool();
  const replica = pool();
  primary.client.$replica = () => replica.client;
  await load(source, primary.client, 'umami', true)('select count(*) from website_event', {});
  assert.equal(primary.calls.length, 0);
  assert.equal(replica.calls.filter(c => c.transaction === 'commit').length, 1);
});
test('schema is a bound and quoted identifier value, never SQL interpolation', async () => {
  const p = pool();
  await load(source, p.client, 'odd"schema, public')('select 1', {});
  const set = p.calls.find(c => c.sql?.includes('set_config'));
  assert.equal(set.sql, "SELECT set_config('search_path', $1, true)");
  assert.equal(set.params[0], '"odd""schema, public"');
});
test('query failure rolls back and does not leak search_path', async () => {
  const p = pool({ fail: true });
  await assert.rejects(load(source, p.client)('select 1', {}), /query_failure/);
  assert.equal(p.calls.at(-1).transaction, 'rollback');
  assert.ok(p.sessions.every(s => s.schema === 'public'));
});
