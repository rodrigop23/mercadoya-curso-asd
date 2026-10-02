# Seed — Sesión 6 (raw CSV)

Fuente reproducible para la zona **raw** del demo Glue → Athena → QuickSight.

Alineado a `BRIEF-ALCANCE.md` (`customers`, `products`, `orders`, `order_items`) y ampliado con `inventory_snapshots` y `payments` para KPIs de stock y tasa de fallo de pago.

## Regenerar

Desde este directorio (o con ruta absoluta):

```bash
node generate.mjs
# opciones:
node generate.mjs --seed 20261001 --products 120 --customers 800 --orders 3500 --days 75 --end-date 2026-09-30
```

Salida: `raw/*.csv` (UTF-8, cabeceras, comillas solo si hace falta).

Los IDs son UUIDs **estables** derivados de `(namespace, índice)` + `--seed` del PRNG; misma semilla ⇒ mismos archivos.

## Archivos y schema

| Archivo | Filas tipicas | Columnas | Notas |
| --- | --- | --- | --- |
| `raw/customers.csv` | ~800 | `customer_id`, `signup_date`, `city`, `segment`, `email` | Emails fake `@example.pe`. ~2% `city` nulo (ETL). |
| `raw/products.csv` | ~120 | `product_id`, `title`, `category`, `price`, `stock`, `stock_status`, `currency` | Precios PEN. `stock_status`: `out_of_stock` / `low` / `ok` / `high`. ~1% `category` nulo. |
| `raw/inventory_snapshots.csv` | products × 4 fechas | `snapshot_id`, `product_id`, `snapshot_date`, `quantity_on_hand`, `quantity_reserved`, `quantity_available`, `warehouse` | Snapshots a 0/7/14/30 días antes de `end-date`. |
| `raw/orders.csv` | ~3500 | `order_id`, `customer_id`, `order_date`, `status`, `total_amount`, `currency`, `channel` | Ventana ~75 días. Status: `confirmed`, `pending`, `rejected`, `cancelled`, `shipped` (+ algunos nulos). |
| `raw/order_items.csv` | ~1–5 × orders | `order_item_id`, `order_id`, `product_id`, `quantity`, `unit_price`, `line_total` | FK a `orders` y `products`. |
| `raw/payments.csv` | ≈ orders | `payment_id`, `order_id`, `amount`, `currency`, `status`, `provider`, `provider_ref`, `created_at`, `paid_at` | Provider `polar`. Status Polar-ish: `succeeded`, `failed`, `pending`, `canceled`. 1:1 salvo algunos rejected sin intento. |

### Integridad referencial

- Todo `orders.customer_id` ∈ `customers.customer_id`
- Todo `order_items.order_id` ∈ `orders.order_id`
- Todo `order_items.product_id` ∈ `products.product_id`
- Todo `payments.order_id` ∈ `orders.order_id`
- Todo `inventory_snapshots.product_id` ∈ `products.product_id`
- `orders.total_amount` ≈ suma de `order_items.line_total` (salvo filas con `total_amount` nulo a propósito)

## KPIs de ejemplo (Athena / QuickSight)

```sql
-- Ventas diarias (órdenes confirmadas/enviadas)
SELECT date(order_date) AS day, sum(total_amount) AS sales_pen
FROM orders
WHERE status IN ('confirmed', 'shipped') AND total_amount IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- Tasa de fallo de pago
SELECT
  count_if(status = 'failed') * 1.0 / count(*) AS fail_rate
FROM payments;

-- Stock bajo (snapshot más reciente)
SELECT p.product_id, p.title, s.quantity_available
FROM products p
JOIN inventory_snapshots s ON s.product_id = p.product_id
WHERE s.snapshot_date = (SELECT max(snapshot_date) FROM inventory_snapshots)
  AND s.quantity_available <= 10;
```

## PII

Solo emails sintéticos (`buyerNNNN@example.pe`). Sin nombres reales, DNI ni teléfonos.
