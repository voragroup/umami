import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import { databaseMigrationUrl } from './src/lib/database-tls.mjs';

export default defineConfig({
  datasource: {
    url: databaseMigrationUrl(env('DATABASE_URL'), process.env.DATABASE_SSL_CA_FILE),
  },
});
