CREATE TABLE "admin_refresh_tokens" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_refresh_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"token_hash" varchar(255) NOT NULL,
	"admin_user_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role" varchar(20) DEFAULT 'ADMIN' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"avatar_url" varchar(512),
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_users_role_check" CHECK ("admin_users"."role" IN ('SUPER_ADMIN', 'ADMIN', 'OPERATOR')),
	CONSTRAINT "admin_users_status_check" CHECK ("admin_users"."status" IN ('ACTIVE', 'DISABLED'))
);
--> statement-breakpoint
ALTER TABLE "admin_refresh_tokens" ADD CONSTRAINT "admin_refresh_tokens_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_refresh_tokens_admin_user_id_idx" ON "admin_refresh_tokens" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_refresh_tokens_expires_at_idx" ON "admin_refresh_tokens" USING btree ("expires_at") WHERE "admin_refresh_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "admin_users_role_status_idx" ON "admin_users" USING btree ("role","status");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_lower_idx" ON "admin_users" USING btree (LOWER("email"));