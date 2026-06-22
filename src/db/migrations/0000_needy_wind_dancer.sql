CREATE EXTENSION IF NOT EXISTS ltree;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_hash_unique" UNIQUE("email_hash")
);
--> statement-breakpoint
CREATE TABLE "cached_metrics" (
	"node_id" bigint PRIMARY KEY NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"direct" integer DEFAULT 0 NOT NULL,
	"max_depth" integer DEFAULT 0 NOT NULL,
	"countries" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_signals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"node_id" bigint NOT NULL,
	"fingerprint" text,
	"ip_hash" text,
	"ua" text,
	"botid_verdict" text,
	"incognito_guess" boolean,
	"risk_score" integer,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"referrer_id" bigint,
	"local_id" text NOT NULL,
	"fingerprint" text,
	"account_id" bigint,
	"class" text DEFAULT 'human' NOT NULL,
	"ephemeral" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"country" text,
	"lat" double precision,
	"lng" double precision,
	"geo_precise" boolean DEFAULT false NOT NULL,
	"path" "ltree",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE INDEX "node_signals_node_idx" ON "node_signals" USING btree ("node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_local_id_uniq" ON "nodes" USING btree ("local_id");--> statement-breakpoint
CREATE INDEX "nodes_referrer_idx" ON "nodes" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "nodes_account_idx" ON "nodes" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "nodes_fingerprint_idx" ON "nodes" USING btree ("fingerprint");--> statement-breakpoint
-- ── ltree + graph constraints (hand-authored; drizzle-kit cannot emit these) ──
-- GiST index powers `path <@ :ancestor` subtree scans and `@>` ancestry.
CREATE INDEX "nodes_path_gist" ON "nodes" USING gist ("path");--> statement-breakpoint
-- Foreign keys.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_referrer_fk" FOREIGN KEY ("referrer_id") REFERENCES "nodes"("id");--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_account_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id");--> statement-breakpoint
ALTER TABLE "cached_metrics" ADD CONSTRAINT "cached_metrics_node_fk" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "node_signals" ADD CONSTRAINT "node_signals_node_fk" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Partial index: leaderboard / globe read only human-class nodes (DESIGN §5).
CREATE INDEX "nodes_human_referrer_idx" ON "nodes" USING btree ("referrer_id") WHERE "class" = 'human';--> statement-breakpoint
-- Leaderboard read path.
CREATE INDEX "cached_metrics_reach_idx" ON "cached_metrics" USING btree ("reach" DESC);--> statement-breakpoint
-- referrer_id is WRITE-ONCE: once non-null it can never change (DESIGN §2 invariant).
CREATE OR REPLACE FUNCTION enforce_referrer_write_once() RETURNS trigger AS $$
BEGIN
  IF OLD.referrer_id IS NOT NULL AND NEW.referrer_id IS DISTINCT FROM OLD.referrer_id THEN
    RAISE EXCEPTION 'referrer_id is write-once (node %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER nodes_referrer_write_once
  BEFORE UPDATE ON "nodes"
  FOR EACH ROW EXECUTE FUNCTION enforce_referrer_write_once();--> statement-breakpoint
-- Derive depth + ltree path on insert. A sibling CTE cannot UPDATE a row another
-- CTE just INSERTed (same snapshot), so path/depth MUST be set here, not after.
-- Uses the row's own id (available BEFORE INSERT once the serial default fires).
CREATE OR REPLACE FUNCTION set_node_path() RETURNS trigger AS $$
DECLARE
  parent_path ltree;
  parent_depth int;
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := nextval(pg_get_serial_sequence('nodes', 'id'));
  END IF;
  IF NEW.referrer_id IS NULL THEN
    NEW.path := NEW.id::text::ltree;
    NEW.depth := 0;
  ELSE
    SELECT path, depth INTO parent_path, parent_depth FROM nodes WHERE id = NEW.referrer_id;
    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'referrer % not found / no path', NEW.referrer_id;
    END IF;
    NEW.path := parent_path || NEW.id::text::ltree;
    NEW.depth := parent_depth + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER nodes_set_path
  BEFORE INSERT ON "nodes"
  FOR EACH ROW EXECUTE FUNCTION set_node_path();