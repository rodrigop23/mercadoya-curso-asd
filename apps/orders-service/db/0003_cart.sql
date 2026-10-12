ALTER TABLE orders_order ADD COLUMN IF NOT EXISTS items jsonb;
ALTER TABLE orders_payment_checkout ADD COLUMN IF NOT EXISTS items jsonb;
ALTER TABLE orders_payment_checkout ADD COLUMN IF NOT EXISTS bundle_state text NOT NULL DEFAULT 'queued';
ALTER TABLE orders_payment_checkout ADD COLUMN IF NOT EXISTS bundle_product_id uuid;
