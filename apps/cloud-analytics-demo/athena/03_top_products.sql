-- Top 10 del período completo, por importe de líneas de pedidos confirmed/shipped.
-- Sumar o.total_amount aquí repetiría el total por cada línea del pedido.
-- p.price es una referencia actual; la venta usa i.line_total histórico.
SELECT
    p.product_id,
    p.title,
    coalesce(p.category, '(sin categoría)') AS category,
    p.price AS catalog_price,
    p.currency AS catalog_currency,
    o.currency AS sales_currency,
    count(DISTINCT o.order_id) AS order_count,
    sum(i.quantity) AS units_sold,
    count(*) AS item_count,
    count(i.line_total) AS items_with_amount,
    sum(i.line_total) AS product_sales_amount
FROM mercadoya_analytics_demo_curated.order_items i
JOIN mercadoya_analytics_demo_curated.orders o ON i.order_id = o.order_id
JOIN mercadoya_analytics_demo_curated.products p ON i.product_id = p.product_id
WHERE o.status IN ('confirmed', 'shipped')
GROUP BY p.product_id, p.title, p.category, p.price, p.currency, o.currency
ORDER BY product_sales_amount DESC NULLS LAST, p.product_id, o.currency
LIMIT 10;
