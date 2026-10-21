-- =============================================================================
-- 03_idempotency.sql (PostgreSQL)
-- Corresponds to: src/database/drizzle/schema/idempotency.schema.ts
-- Powers @nestjs/idempotency with atomic PostgreSQL leasing & payload replay
-- =============================================================================

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
    "key_hash" varchar(64) PRIMARY KEY,
    "key" text NOT NULL,
    "fingerprint" text NOT NULL,
    "owner" text,
    "response" jsonb,
    "expires_at" bigint NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_at_idx" ON "idempotency_keys" ("expires_at");
