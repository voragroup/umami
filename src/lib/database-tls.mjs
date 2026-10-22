// Server/build configuration only. Never imported by browser code.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';

function certificateConfig(connectionString, certificateFile) {
  if (certificateFile === undefined) return null;
  try {
    if (typeof certificateFile !== 'string' || !certificateFile.trim()) throw Error();
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw Error();
    // pg URL TLS options can replace the explicit ssl object. Reject ambiguity
    // rather than silently disabling validation or ignoring an operator option.
    for (const key of url.searchParams.keys()) {
      if (/^ssl/i.test(key) || key.toLowerCase() === 'uselibpqcompat') throw Error();
    }
    const path = resolve(certificateFile);
    const ca = readFileSync(path, 'utf8');
    if (ca.length > 65536 || !new X509Certificate(ca).ca) throw Error();
    return { url, path, ca };
  } catch {
    // Never include the URL, password, certificate path or filesystem error.
    throw new Error('Invalid database TLS configuration');
  }
}

export function databaseConnectionConfig(connectionString, certificateFile) {
  const config = certificateConfig(connectionString, certificateFile);
  return config
    ? { connectionString, ssl: { ca: config.ca, rejectUnauthorized: true } }
    : { connectionString };
}

export function databaseMigrationUrl(connectionString, certificateFile) {
  const config = certificateConfig(connectionString, certificateFile);
  if (!config) return connectionString;
  // Prisma's migration engine uses its own TLS URL settings, not pg's object.
  config.url.searchParams.set('sslmode', 'require');
  config.url.searchParams.set('sslaccept', 'strict');
  config.url.searchParams.set('sslcert', config.path);
  return config.url.href;
}
