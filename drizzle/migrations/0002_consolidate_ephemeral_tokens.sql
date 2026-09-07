CREATE TABLE "ephemeral_tokens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ephemeral_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" varchar(50) NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"user_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ephemeral_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
INSERT INTO "ephemeral_tokens" ("type", "token_hash", "user_id", "expires_at", "used_at", "created_at")
SELECT 'email_verification', "token_hash", "user_id", "expires_at", "used_at", "created_at"
FROM "email_verification_tokens"
ON CONFLICT ("token_hash") DO NOTHING;
--> statement-breakpoint
INSERT INTO "ephemeral_tokens" ("type", "token_hash", "user_id", "expires_at", "used_at", "created_at")
SELECT 'password_reset', "token_hash", "user_id", "expires_at", "used_at", "created_at"
FROM "password_reset_tokens"
ON CONFLICT ("token_hash") DO NOTHING;
--> statement-breakpoint
DROP TABLE "email_verification_tokens" CASCADE;--> statement-breakpoint
DROP TABLE "password_reset_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "ephemeral_tokens" ADD CONSTRAINT "ephemeral_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ephemeral_tokens_user_id_type_idx" ON "ephemeral_tokens" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "ephemeral_tokens_expires_at_idx" ON "ephemeral_tokens" USING btree ("expires_at") WHERE "ephemeral_tokens"."used_at" IS NULL;