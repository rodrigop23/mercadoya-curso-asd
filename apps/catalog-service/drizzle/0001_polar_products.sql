CREATE TABLE "catalog_polar_product" (
	"product_id" uuid NOT NULL,
	"server" text NOT NULL,
	"desired" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"synced_version" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"polar_product_id" uuid,
	"error_code" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_polar_product_product_id_server_pk" PRIMARY KEY("product_id","server"),
	CONSTRAINT "catalog_polar_product_server_polar_product_id_unique" UNIQUE("server","polar_product_id"),
	CONSTRAINT "catalog_polar_product_server" CHECK ("catalog_polar_product"."server" IN ('sandbox', 'production')),
	CONSTRAINT "catalog_polar_product_state" CHECK ("catalog_polar_product"."state" IN ('queued', 'creating', 'synced', 'error'))
);
--> statement-breakpoint
CREATE INDEX "catalog_polar_product_pending" ON "catalog_polar_product" USING btree ("next_attempt_at") WHERE "catalog_polar_product"."state" <> 'synced';
