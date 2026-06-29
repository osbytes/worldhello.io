CREATE TABLE "link_tokens" (
	"code" text PRIMARY KEY NOT NULL,
	"source_local_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "link_tokens_expires_idx" ON "link_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "link_tokens_source_idx" ON "link_tokens" USING btree ("source_local_id");