CREATE TABLE "otp_send_windows" (
	"target" text,
	"purpose" text,
	"window_started_at" timestamp with time zone NOT NULL,
	"send_count" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "otp_send_windows_pkey" PRIMARY KEY("target","purpose")
);
--> statement-breakpoint
CREATE INDEX "otp_send_windows_window_started_at_idx" ON "otp_send_windows" ("window_started_at");