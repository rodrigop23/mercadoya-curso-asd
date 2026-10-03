ALTER TABLE inventory_reservations ADD COLUMN IF NOT EXISTS items jsonb;
--> statement-breakpoint
ALTER TABLE inventory_reservations ADD COLUMN IF NOT EXISTS released_at timestamp;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS catalog_stock_operation (
  id text PRIMARY KEY,
  adjustments jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
