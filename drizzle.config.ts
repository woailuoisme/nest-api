import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DB_URL;
if (!databaseUrl) {
  throw new Error('DB_URL environment variable is required for drizzle-kit');
}

export default defineConfig({
  schema: './src/database/drizzle/schema/*.schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
