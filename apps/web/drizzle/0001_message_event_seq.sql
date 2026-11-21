ALTER TABLE "messages" ADD COLUMN "event_seq" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reverted_by_seq" integer;
