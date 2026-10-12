ALTER TABLE orders_order ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE orders_order ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
UPDATE orders_order
  SET expires_at = created_at AT TIME ZONE 'UTC'
    + COALESCE(NULLIF(current_setting('mercadoya.order_pending_ttl_minutes', true), ''), '15')::integer
      * interval '1 minute'
  WHERE status = 'pending' AND expires_at IS NULL;
CREATE INDEX IF NOT EXISTS orders_order_pending_expiry
  ON orders_order(expires_at) WHERE status = 'pending';
ALTER TABLE orders_payment_checkout ADD COLUMN IF NOT EXISTS late_payment jsonb;
