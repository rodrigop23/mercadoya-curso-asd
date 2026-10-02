ALTER TABLE "catalog_polar_product" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "catalog_polar_product" ALTER COLUMN "next_attempt_at" DROP NOT NULL;
--> statement-breakpoint
-- Los errores del worker anterior todavía estaban programados para reintentar.
-- Conserva los UUID remotos y permite un intento con el payload corregido.
UPDATE "catalog_polar_product" SET state='queued', error_code=NULL, next_attempt_at=now()
WHERE state='error';
