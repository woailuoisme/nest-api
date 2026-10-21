import { defineConfig } from 'drizzle-kit';

import { DEFAULT_DB_URL } from './src/common/constants/app.constants';

// 与运行时保持同一套默认值：本地可不在 .env 中写 DB_URL（生产由运行时校验强制显式配置）
const databaseUrl = process.env.DB_URL || DEFAULT_DB_URL;

export default defineConfig({
  schema: './src/database/drizzle/schema/*.schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
});
