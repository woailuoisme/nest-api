import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/database/drizzle/schema';

const connectionString = process.env.DB_URL || 'postgresql://localhost:5432/nestforge';

export const authClient = postgres(connectionString, {
  max: 5,
  idle_timeout: 30,
  connect_timeout: 5,
  prepare: false,
  onnotice: () => {},
});

export const authDrizzle = drizzle(authClient, { schema });

export const authDatabaseAdapter = drizzleAdapter(authDrizzle, {
  provider: 'pg',
  schema,
});
