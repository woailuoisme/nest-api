-- Migration: 0005_add_passkey_and_anonymous
-- Add is_anonymous column to user table and create passkey table

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "is_anonymous" boolean DEFAULT false;

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