ALTER TABLE orders_order ADD COLUMN IF NOT EXISTS payment_product jsonb;
ALTER TABLE orders_payment_checkout ADD COLUMN IF NOT EXISTS product jsonb;
