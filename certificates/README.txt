OPTIONAL VERIFIED DATABASE TLS

Set server/build environment DATABASE_SSL_CA_FILE to
certificates/supabase-ca-2021.pem for a database using that CA. Do not expose this
environment variable via NEXT_PUBLIC or the Next.js client env block.

The application, read replica, database build check and seed adapter all pass
the CA to node-postgres with rejectUnauthorized=true. The Prisma CLI config
adds sslmode=require, sslaccept=strict and the absolute CA path for migration
engine connections. Existing DATABASE_URL schema options are preserved. Remove
conflicting SSL query options first: they are intentionally rejected because pg
can replace the explicit TLS object with URL settings. No connection URL or
credential belongs in this repository. This certificate is public, not a secret.

When DATABASE_SSL_CA_FILE is absent, existing behavior is unchanged. An empty,
missing or invalid configured certificate fails closed. The certificate is
included in Next.js standalone/serverless tracing. Deploy and verify actual
connections before enabling provider-wide SSL enforcement; other clients may
also need updating. This change does not enable a provider setting or migrate
the database automatically. Do not skip hostname or certificate validation.

CA source:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
SHA-256 fingerprint:
807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA
Certificate expiry: April 26, 2031. Rotate via reviewed vendor certificate update.

References:
https://node-postgres.com/features/ssl
https://docs.prisma.io/docs/orm/core-concepts/supported-databases/postgresql

Local test: node --test scripts/test-database-tls.mjs
Tests use synthetic URLs and the public CA, without database access.

Verification, October 22, 2026:
- Five TLS configuration tests and six schema-pooling regressions pass.
- Actual Prisma/pg runtime connection with CA verification succeeds.
- Protected Vercel preview build passes its database connection/version checks;
  a database-backed missing-share request returns the expected JSON 404, proving
  that the runtime can load its packaged certificate and execute the lookup.
- The full TypeScript check still has 20 baseline errors; the existing comparison
  harness confirms identical diagnostics with the prior Prisma implementation.
- Read-only Prisma migration status fails certificate trust validation on the
  current Mac/provider setup. Migration TLS compatibility is NOT established;
  do not bypass certificate validation. Existing SKIP_DB_MIGRATION remains on.
  No schema migrations are part of this change.
