// Integration check using the locked Prisma client and an in-memory PGlite
// server. The server binds loopback only; no production environment is read.
// This checks the real Prisma batch API, not Supabase's transaction pool.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const require = createRequire(import.meta.url);
// PGlite is part of the locked Prisma development dependency tree.
const prismaDir = path.dirname(require.resolve('prisma/package.json'));
const devDir = path.dirname(require.resolve('@prisma/dev', { paths: [prismaDir] }));
const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite', { paths: [devDir] })));
const { PGLiteSocketServer } = await import(pathToFileURL(require.resolve('@electric-sql/pglite-socket', { paths: [devDir] })));

const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 0, maxConnections: 1 });
let client;

try {
  await db.exec('CREATE SCHEMA umami; CREATE TABLE umami.website_event (website_id text);');
  await db.query('INSERT INTO umami.website_event VALUES ($1), ($1)', ['fixture']);
  await server.start();
  const connectionString = `postgresql://postgres:postgres@${server.getServerConn()}/postgres`;
  assert.equal(new URL(connectionString).hostname, '127.0.0.1');
  client = new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: 1 }, { schema: 'umami' }),
  });

  const source = fs.readFileSync(new URL('../src/lib/prisma.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function rawQuery(');
  const end = source.indexOf('\nasync function pagedQuery', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({ client, getSchema: () => 'umami', process: { env: {} }, log: () => {} });
  const run = vm.runInContext(`${stripTypeScriptTypes(source.slice(start, end))}\nrawQuery`, context);
  const before = await client.$queryRawUnsafe('SHOW search_path');

  for (let i = 0; i < 12; i++) {
    const rows = await run('SELECT count(*)::int AS count FROM website_event WHERE website_id={{id}}', { id: 'fixture' });
    assert.equal(rows[0].count, 2);
    assert.deepEqual(await client.$queryRawUnsafe('SHOW search_path'), before);
  }
  assert.equal((await run('SELECT count(*)::int AS count FROM website_event WHERE website_id={{id}}', { id: 'absent' }))[0].count, 0);
  await assert.rejects(run('SELECT 1/0', {}), /division by zero/);
  assert.deepEqual(await client.$queryRawUnsafe('SHOW search_path'), before);
  assert.equal((await run('SELECT count(*)::int AS count FROM website_event', {}))[0].count, 2);
  console.log('PASS: real Prisma batch execution, 12 repeated reads, parameter binding, rollback, path reset and recovery; local fixture only.');
} finally {
  if (client) await client.$disconnect();
  await server.stop();
  await db.close();
}
