-- =============================================================================
-- Migration: 0004_better_auth
-- Replace legacy auth/admin with Better Auth 14+ plugins and UUIDv7
-- =============================================================================

-- Drop legacy tables
DROP TABLE IF EXISTS "refresh_tokens" CASCADE;
DROP TABLE IF EXISTS "ephemeral_tokens" CASCADE;
DROP TABLE IF EXISTS "oauth_accounts" CASCADE;
DROP TABLE IF EXISTS "admin_refresh_tokens" CASCADE;
DROP TABLE IF EXISTS "admin_users" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;

-- Create Better Auth core and plugin tables
CREATE TABLE IF NOT EXISTS "user" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "name" text NOT NULL,
    "email" text NOT NULL UNIQUE,
    "email_verified" boolean NOT NULL DEFAULT false,
    "image" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "role" text NOT NULL DEFAULT 'USER',
    "banned" boolean DEFAULT false,
    "ban_reason" text,
    "ban_expires" timestamp with time zone,
    "two_factor_enabled" boolean DEFAULT false,
    "username" text UNIQUE,
    "display_username" text,
    "phone_number" text UNIQUE,
    "phone_number_verified" boolean,
    "last_login_method" text,
    "is_anonymous" boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS "session" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "expires_at" timestamp with time zone NOT NULL,
    "token" text NOT NULL UNIQUE,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "ip_address" text,
    "user_agent" text,
    "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "impersonated_by" text,
    "active_organization_id" text
);
CREATE INDEX IF NOT EXISTS "session_user_id_idx" ON "session" ("user_id");

CREATE TABLE IF NOT EXISTS "account" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "account_id" text NOT NULL,
    "provider_id" text NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "access_token" text,
    "refresh_token" text,
    "id_token" text,
    "access_token_expires_at" timestamp with time zone,
    "refresh_token_expires_at" timestamp with time zone,
    "scope" text,
    "password" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "account_user_id_idx" ON "account" ("user_id");

CREATE TABLE IF NOT EXISTS "verification" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

CREATE TABLE IF NOT EXISTS "two_factor" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "secret" text NOT NULL,
    "backup_codes" text NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "verified" boolean DEFAULT true,
    "failed_verification_count" integer DEFAULT 0,
    "locked_until" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "two_factor_secret_idx" ON "two_factor" ("secret");
CREATE INDEX IF NOT EXISTS "two_factor_user_id_idx" ON "two_factor" ("user_id");

CREATE TABLE IF NOT EXISTS "apikey" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "config_id" text NOT NULL DEFAULT 'default',
    "name" text,
    "start" text,
    "reference_id" uuid NOT NULL,
    "prefix" text,
    "key" text NOT NULL,
    "refill_interval" integer,
    "refill_amount" integer,
    "last_refill_at" timestamp with time zone,
    "enabled" boolean DEFAULT true,
    "rate_limit_enabled" boolean DEFAULT true,
    "rate_limit_time_window" integer DEFAULT 86400000,
    "rate_limit_max" integer DEFAULT 10,
    "request_count" integer DEFAULT 0,
    "remaining" integer,
    "last_request" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "permissions" text,
    "metadata" text
);
CREATE INDEX IF NOT EXISTS "apikey_config_id_idx" ON "apikey" ("config_id");
CREATE INDEX IF NOT EXISTS "apikey_reference_id_idx" ON "apikey" ("reference_id");
CREATE INDEX IF NOT EXISTS "apikey_key_idx" ON "apikey" ("key");

CREATE TABLE IF NOT EXISTS "organization" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "name" text NOT NULL,
    "slug" text NOT NULL UNIQUE,
    "logo" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "metadata" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "organization_slug_uidx" ON "organization" ("slug");

CREATE TABLE IF NOT EXISTS "member" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "role" text NOT NULL DEFAULT 'member',
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "member_organization_id_idx" ON "member" ("organization_id");
CREATE INDEX IF NOT EXISTS "member_user_id_idx" ON "member" ("user_id");

CREATE TABLE IF NOT EXISTS "invitation" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "email" text NOT NULL,
    "role" text,
    "status" text NOT NULL DEFAULT 'pending',
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "inviter_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "invitation_organization_id_idx" ON "invitation" ("organization_id");
CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON "invitation" ("email");

CREATE TABLE IF NOT EXISTS "jwks" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "public_key" text NOT NULL,
    "private_key" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "expires_at" timestamp with time zone,
    "alg" text,
    "crv" text
);

CREATE TABLE IF NOT EXISTS "device_code" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "device_code" text NOT NULL,
    "user_code" text NOT NULL,
    "user_id" uuid REFERENCES "user"("id") ON DELETE CASCADE,
    "expires_at" timestamp with time zone NOT NULL,
    "status" text NOT NULL,
    "last_polled_at" timestamp with time zone,
    "polling_interval" integer,
    "client_id" text,
    "scope" text
);

CREATE TABLE IF NOT EXISTS "passkey" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "name" text,
    "public_key" text NOT NULL,
    "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "credential_id" text NOT NULL,
    "counter" integer NOT NULL DEFAULT 0,
    "device_type" text NOT NULL,
    "backed_up" boolean NOT NULL DEFAULT false,
    "transports" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "aaguid" text
);
CREATE INDEX IF NOT EXISTS "passkey_user_id_idx" ON "passkey" ("user_id");
CREATE INDEX IF NOT EXISTS "passkey_credential_id_idx" ON "passkey" ("credential_id");

-- Update downstream polymorphic columns from bigint to uuid
ALTER TABLE "media" DROP COLUMN IF EXISTS "model_id";
ALTER TABLE "media" ADD COLUMN "model_id" uuid NOT NULL;
CREATE INDEX IF NOT EXISTS "media_model_collection_idx" ON "media" ("model_type", "model_id", "collection_name");
CREATE INDEX IF NOT EXISTS "media_model_order_idx" ON "media" ("model_type", "model_id", "order_column");

ALTER TABLE "notifications" DROP COLUMN IF EXISTS "notifiable_id";
ALTER TABLE "notifications" ADD COLUMN "notifiable_id" uuid NOT NULL;
CREATE INDEX IF NOT EXISTS "notifications_notifiable_created_at_idx" ON "notifications" ("notifiable_type", "notifiable_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "notifications_unread_idx" ON "notifications" ("notifiable_type", "notifiable_id") WHERE "read_at" IS NULL;

ALTER TABLE "idempotency_keys" DROP COLUMN IF EXISTS "user_id";
ALTER TABLE "idempotency_keys" ADD COLUMN "user_id" uuid;
