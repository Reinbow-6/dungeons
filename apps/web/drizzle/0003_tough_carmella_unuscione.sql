CREATE TABLE "rate_limit_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_key" text NOT NULL,
	"window_start" integer NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_facts" ADD COLUMN "event_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_facts" ADD COLUMN "reverted_by_seq" integer;--> statement-breakpoint
ALTER TABLE "memory_facts" ADD COLUMN "source" text DEFAULT 'engine' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_bucket_window_idx" ON "rate_limit_buckets" USING btree ("bucket_key","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_members_campaign_guest_idx" ON "campaign_members" USING btree ("campaign_id","guest_id");--> statement-breakpoint
CREATE INDEX "campaign_members_guest_idx" ON "campaign_members" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "memory_facts_campaign_seq_idx" ON "memory_facts" USING btree ("campaign_id","event_seq");--> statement-breakpoint
CREATE INDEX "sessions_campaign_number_idx" ON "sessions" USING btree ("campaign_id","session_number");