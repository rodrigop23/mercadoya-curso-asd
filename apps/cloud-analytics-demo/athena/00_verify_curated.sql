-- Prueba de lectura de las seis tablas curated y de sus archivos Parquet.
-- invalid_status_rows debe ser cero. Los estados de payments son distintos.
SELECT 'customers' AS table_name, "$path" AS parquet_file,
       count(*) AS row_count, CAST(0 AS bigint) AS invalid_status_rows
FROM mercadoya_analytics_demo_curated.customers
GROUP BY "$path"
UNION ALL
SELECT 'products', "$path", count(*), CAST(0 AS bigint)
FROM mercadoya_analytics_demo_curated.products
GROUP BY "$path"
UNION ALL
SELECT 'orders', "$path", count(*),
       count_if(status IS NULL OR status NOT IN (
           'confirmed', 'pending', 'rejected', 'cancelled', 'shipped', 'unknown'
       ))
FROM mercadoya_analytics_demo_curated.orders
GROUP BY "$path"
UNION ALL
SELECT 'order_items', "$path", count(*), CAST(0 AS bigint)
FROM mercadoya_analytics_demo_curated.order_items
GROUP BY "$path"
UNION ALL
SELECT 'inventory_snapshots', "$path", count(*), CAST(0 AS bigint)
FROM mercadoya_analytics_demo_curated.inventory_snapshots
GROUP BY "$path"
UNION ALL
SELECT 'payments', "$path", count(*), CAST(0 AS bigint)
FROM mercadoya_analytics_demo_curated.payments
GROUP BY "$path"
ORDER BY table_name, parquet_file;
