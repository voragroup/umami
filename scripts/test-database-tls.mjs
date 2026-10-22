import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { databaseConnectionConfig, databaseMigrationUrl } from '../src/lib/database-tls.mjs';
const url = 'postgresql://synthetic:secret@example.invalid:5432/postgres?schema=umami';
const file = 'certificates/supabase-ca-2021.pem';

test('absent CA option preserves existing connection behavior', () => {
  assert.deepEqual(databaseConnectionConfig(url), { connectionString: url });
  assert.equal(databaseMigrationUrl(url), url);
});
test('CA enables verified pg TLS without losing schema or credentials', () => {
  const config = databaseConnectionConfig(url, file);
  assert.equal(config.connectionString, url);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(new X509Certificate(config.ssl.ca).fingerprint256,
    '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
});
test('Prisma migration engine gets strict TLS and an absolute trusted certificate path', () => {
  const migration = new URL(databaseMigrationUrl(url, file));
  assert.equal(migration.searchParams.get('sslmode'), 'require');
  assert.equal(migration.searchParams.get('sslaccept'), 'strict');
  assert.equal(migration.searchParams.get('sslcert'), resolve(file));
  assert.equal(migration.searchParams.get('schema'), 'umami');
  assert.equal(migration.password, 'secret');
});
test('conflicting TLS URL parameters cannot replace explicit certificate verification', () => {
  for (const key of ['ssl', 'sslmode', 'sslcert', 'sslrootcert', 'sslkey', 'sslaccept', 'uselibpqcompat']) {
    for (const fn of [databaseConnectionConfig, databaseMigrationUrl]) {
      assert.throws(() => fn(`${url}&${key}=disable`, file), { message: 'Invalid database TLS configuration' });
    }
  }
});
test('malformed certificate settings fail closed with sanitized errors', () => {
  for (const bad of ['', 'missing-private-path', 'package.json']) {
    for (const fn of [databaseConnectionConfig, databaseMigrationUrl]) {
      assert.throws(() => fn(url, bad), { message: 'Invalid database TLS configuration' });
    }
  }
});
