CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"avatar_path" text,
	"role" text,
	"phone_number" text UNIQUE,
	"phone_number_verified" boolean DEFAULT false,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_tokens" (
	"id" text PRIMARY KEY,
	"purpose" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"fingerprint" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_authenticators" (
	"user_id" text PRIMARY KEY,
	"secret" text NOT NULL,
	"confirmed" boolean NOT NULL,
	"pending_secret" text,
	"last_used_step" integer
);
--> statement-breakpoint
CREATE TABLE "mfa_failures" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "mfa_failures_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"failed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"user_id" text,
	"code_hash" text,
	CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY("user_id","code_hash")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" text PRIMARY KEY,
	"channel" text NOT NULL,
	"target" text NOT NULL,
	"purpose" text NOT NULL,
	"user_id" text,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_send_windows" (
	"target" text,
	"purpose" text,
	"window_started_at" timestamp with time zone NOT NULL,
	"send_count" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "otp_send_windows_pkey" PRIMARY KEY("target","purpose")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY,
	"family_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"family_expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked" boolean DEFAULT false NOT NULL,
	"claims" jsonb
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"mfa" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key_hash" varchar(64) PRIMARY KEY,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"owner" text,
	"response" json,
	"expires_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"type" varchar(255) NOT NULL,
	"notifiable_type" varchar(255) NOT NULL,
	"notifiable_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_expires_at_idx" ON "api_keys" ("expires_at");--> statement-breakpoint
CREATE INDEX "email_tokens_user_id_purpose_idx" ON "email_tokens" ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "email_tokens_expires_at_idx" ON "email_tokens" ("expires_at");--> statement-breakpoint
CREATE INDEX "mfa_failures_user_id_failed_at_idx" ON "mfa_failures" ("user_id","failed_at");--> statement-breakpoint
CREATE INDEX "mfa_failures_failed_at_idx" ON "mfa_failures" ("failed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "otp_codes_target_purpose_uidx" ON "otp_codes" ("target","purpose");--> statement-breakpoint
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes" ("expires_at");--> statement-breakpoint
CREATE INDEX "otp_send_windows_window_started_at_idx" ON "otp_send_windows" ("window_started_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens" ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_expires_at_idx" ON "refresh_tokens" ("family_expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" ("expires_at");--> statement-breakpoint
CREATE INDEX "notifications_notifiable_created_at_idx" ON "notifications" ("notifiable_type","notifiable_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" ("notifiable_type","notifiable_id") WHERE ("read_at" is null);--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;