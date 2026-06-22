CREATE TABLE "magic_tokens" (
	"nonce" text PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"local_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "magic_tokens_expires_idx" ON "magic_tokens" USING btree ("expires_at");--> statement-breakpoint
-- ── Performance: partial indexes for hot read paths (audit fixes) ──
-- rankOf counts human nodes — avoid full scan on `class`.
CREATE INDEX "nodes_human_idx" ON "nodes" USING btree ("id") WHERE "class" = 'human';--> statement-breakpoint
-- globeData points query: human, non-ephemeral, geolocated, newest-first.
CREATE INDEX "nodes_globe_idx" ON "nodes" USING btree ("created_at" DESC)
  WHERE "class" = 'human' AND "ephemeral" = false AND "lat" IS NOT NULL;--> statement-breakpoint
-- globeData arcs + meDetail children: by referrer, geolocated, newest-first.
CREATE INDEX "nodes_referrer_geo_idx" ON "nodes" USING btree ("referrer_id", "created_at" DESC)
  WHERE "class" = 'human' AND "lat" IS NOT NULL;--> statement-breakpoint
-- resolveNode fingerprint fallback: human only, oldest-first.
CREATE INDEX "nodes_fingerprint_human_idx" ON "nodes" USING btree ("fingerprint", "created_at")
  WHERE "class" = 'human';