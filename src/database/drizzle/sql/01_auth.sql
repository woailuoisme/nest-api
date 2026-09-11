-- =============================================================================
-- Better Auth Core & Plugins DDL (PostgreSQL)
-- 100% Strictly Generated from:
--   src/database/drizzle/schema/better-auth.schema.ts
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. User Core Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user" (
    "id" text PRIMARY KEY,
    "name" text NOT NULL,
    "email" text NOT NULL UNIQUE,
    "email_verified" boolean NOT NULL DEFAULT false,
    "image" text,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "role" text,
    "banned" boolean DEFAULT false,
    "ban_reason" text,
    "ban_expires" timestamp,
    "two_factor_enabled" boolean DEFAULT false,
    "username" text UNIQUE,
    "display_username" text,
    "phone_number" text UNIQUE,
    "phone_number_verified" boolean,
    "is_anonymous" boolean DEFAULT false,
    "last_login_method" text
);

-- -----------------------------------------------------------------------------
-- 2. Session Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "session" (
    "id" text PRIMARY KEY,
    "expires_at" timestamp NOT NULL,
    "token" text NOT NULL UNIQUE,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "ip_address" text,
    "user_agent" text,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "impersonated_by" text,
    "active_organization_id" text
);
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("user_id");

-- -----------------------------------------------------------------------------
-- 3. Account Table (OAuth & Credentials)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "account" (
    "id" text PRIMARY KEY,
    "account_id" text NOT NULL,
    "provider_id" text NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "access_token" text,
    "refresh_token" text,
    "id_token" text,
    "access_token_expires_at" timestamp,
    "refresh_token_expires_at" timestamp,
    "scope" text,
    "password" text,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("user_id");

-- -----------------------------------------------------------------------------
-- 4. Verification Table (Tokens & OTPs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "verification" (
    "id" text PRIMARY KEY,
    "identifier" text NOT NULL,
    "value" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

-- -----------------------------------------------------------------------------
-- 5. Two-Factor Authentication Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "two_factor" (
    "id" text PRIMARY KEY,
    "secret" text NOT NULL,
    "backup_codes" text NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "verified" boolean DEFAULT true,
    "failed_verification_count" integer DEFAULT 0,
    "locked_until" timestamp
);
CREATE INDEX IF NOT EXISTS "twoFactor_secret_idx" ON "two_factor" ("secret");
CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "two_factor" ("user_id");

-- -----------------------------------------------------------------------------
-- 6. Passkey Table (WebAuthn / FIDO2)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "passkey" (
    "id" text PRIMARY KEY,
    "name" text,
    "public_key" text NOT NULL,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "credential_id" text NOT NULL,
    "counter" integer NOT NULL,
    "device_type" text NOT NULL,
    "backed_up" boolean NOT NULL,
    "transports" text,
    "created_at" timestamp,
    "aaguid" text
);
CREATE INDEX IF NOT EXISTS "passkey_userId_idx" ON "passkey" ("user_id");
CREATE INDEX IF NOT EXISTS "passkey_credentialID_idx" ON "passkey" ("credential_id");

-- -----------------------------------------------------------------------------
-- 7. API Key Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "apikey" (
    "id" text PRIMARY KEY,
    "config_id" text NOT NULL DEFAULT 'default',
    "name" text,
    "start" text,
    "reference_id" text NOT NULL,
    "prefix" text,
    "key" text NOT NULL,
    "refill_interval" integer,
    "refill_amount" integer,
    "last_refill_at" timestamp,
    "enabled" boolean DEFAULT true,
    "rate_limit_enabled" boolean DEFAULT true,
    "rate_limit_time_window" integer DEFAULT 86400000,
    "rate_limit_max" integer DEFAULT 10,
    "request_count" integer DEFAULT 0,
    "remaining" integer,
    "last_request" timestamp,
    "expires_at" timestamp,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "permissions" text,
    "metadata" text
);
CREATE INDEX IF NOT EXISTS "apikey_configId_idx" ON "apikey" ("config_id");
CREATE INDEX IF NOT EXISTS "apikey_referenceId_idx" ON "apikey" ("reference_id");
CREATE INDEX IF NOT EXISTS "apikey_key_idx" ON "apikey" ("key");

-- -----------------------------------------------------------------------------
-- 8. Organization Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "organization" (
    "id" text PRIMARY KEY,
    "name" text NOT NULL,
    "slug" text NOT NULL UNIQUE,
    "logo" text,
    "created_at" timestamp NOT NULL,
    "metadata" text
);

-- -----------------------------------------------------------------------------
-- 9. Member Table (Organization Membership)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "member" (
    "id" text PRIMARY KEY,
    "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "role" text NOT NULL DEFAULT 'member',
    "created_at" timestamp NOT NULL
);
CREATE INDEX IF NOT EXISTS "member_organizationId_idx" ON "member" ("organization_id");
CREATE INDEX IF NOT EXISTS "member_userId_idx" ON "member" ("user_id");

-- -----------------------------------------------------------------------------
-- 10. Invitation Table (Organization Invitations)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "invitation" (
    "id" text PRIMARY KEY,
    "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "email" text NOT NULL,
    "role" text,
    "status" text NOT NULL DEFAULT 'pending',
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp NOT NULL,
    "inviter_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "invitation_organizationId_idx" ON "invitation" ("organization_id");
CREATE INDEX IF NOT EXISTS "invitation_email_idx" ON "invitation" ("email");

-- -----------------------------------------------------------------------------
-- 11. JWKS Table (Key Rotation & Discovery)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "jwks" (
    "id" text PRIMARY KEY,
    "public_key" text NOT NULL,
    "private_key" text NOT NULL,
    "created_at" timestamp NOT NULL,
    "expires_at" timestamp,
    "alg" text,
    "crv" text
);

-- -----------------------------------------------------------------------------
-- 12. Device Code Table (RFC 8628 Device Authorization Flow)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "device_code" (
    "id" text PRIMARY KEY,
    "device_code" text NOT NULL,
    "user_code" text NOT NULL,
    "user_id" text,
    "expires_at" timestamp NOT NULL,
    "status" text NOT NULL,
    "last_polled_at" timestamp,
    "polling_interval" integer,
    "client_id" text,
    "scope" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "deviceCode_deviceCode_uidx" ON "device_code" ("device_code");
CREATE UNIQUE INDEX IF NOT EXISTS "deviceCode_userCode_uidx" ON "device_code" ("user_code");

-- -----------------------------------------------------------------------------
-- 13. SSO Provider Table (SAML 2.0 & OIDC Single Sign-On)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sso_provider" (
    "id" text PRIMARY KEY,
    "issuer" text NOT NULL,
    "oidc_config" text,
    "saml_config" text,
    "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "provider_id" text NOT NULL UNIQUE,
    "organization_id" text,
    "domain" text NOT NULL
);
