CREATE TABLE IF NOT EXISTS "adventure_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_guest_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"ruleset_recommended" "ruleset_profile" DEFAULT '5e-full' NOT NULL,
	"pack" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "adventure_packs_owner_slug_idx" ON "adventure_packs" USING btree ("owner_guest_id","slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adventure_packs_owner_updated_idx" ON "adventure_packs" USING btree ("owner_guest_id","updated_at");
