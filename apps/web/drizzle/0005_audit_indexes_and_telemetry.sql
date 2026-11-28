CREATE TABLE IF NOT EXISTS "model_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guest_id" text NOT NULL,
	"user_id" text,
	"access_tier" text DEFAULT 'guest' NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"day_key" text NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"prompt_tokens" bigint DEFAULT 0 NOT NULL,
	"completion_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_tokens" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_usage_guest_model_day_idx" ON "model_usage" USING btree ("guest_id","provider","model_id","day_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_usage_day_idx" ON "model_usage" USING btree ("day_key");--> statement-breakpoint
ALTER TABLE "provider_health" ADD COLUMN IF NOT EXISTS "prompt_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_health" ADD COLUMN IF NOT EXISTS "completion_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_health" ADD COLUMN IF NOT EXISTS "cached_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaigns_owner_updated_idx" ON "campaigns" USING btree ("owner_guest_id","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "characters_campaign_idx" ON "characters" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_campaign_created_idx" ON "messages" USING btree ("campaign_id","created_at");
