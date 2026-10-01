-- Ventas de pedidos confirmed/shipped. No equivale a cobros de payments.
-- El join N:1 con customers conserva una fila por pedido antes de agregar.
SELECT
    CAST(date_trunc('month', o.order_date) AS date) AS month,
    coalesce(c.segment, '(sin segmento)') AS segment,
    coalesce(c.city, '(sin ciudad)') AS city,
    o.currency,
    count(*) AS order_count,
    count(o.total_amount) AS orders_with_amount,
    sum(o.total_amount) AS sales_amount,
    avg(o.total_amount) AS average_order_amount
FROM mercadoya_analytics_demo_curated.orders o
LEFT JOIN mercadoya_analytics_demo_curated.customers c
    ON o.customer_id = c.customer_id
WHERE o.status IN ('confirmed', 'shipped')
GROUP BY 1, 2, 3, 4
ORDER BY month NULLS LAST, sales_amount DESC NULLS LAST, segment, city, o.currency;
