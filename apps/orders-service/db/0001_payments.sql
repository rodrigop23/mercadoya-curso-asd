CREATE TABLE IF NOT EXISTS orders_payment_checkout (
  order_id uuid PRIMARY KEY REFERENCES orders_order(id),
  reservation jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'creating', 'open', 'succeeded', 'failed')),
  checkout_id uuid UNIQUE,
  checkout_url text,
  expires_at timestamptz,
  amount integer,
  currency text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders_payment_webhook (
  event_id text PRIMARY KEY,
  outcome jsonb NOT NULL,
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_payment_webhook_pending
  ON orders_payment_webhook(next_attempt_at) WHERE processed_at IS NULL;
