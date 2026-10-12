CREATE TABLE IF NOT EXISTS orders_payment_product (
  server text PRIMARY KEY CHECK (server IN ('sandbox', 'production')),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'creating', 'ready')),
  product_id uuid,
  CHECK ((state = 'ready') = (product_id IS NOT NULL))
);
