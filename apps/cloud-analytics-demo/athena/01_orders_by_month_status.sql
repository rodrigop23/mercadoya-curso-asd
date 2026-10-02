-- Una fila por mes UTC, estado, canal y moneda. Incluye todos los estados.
-- Un mes NULL permite ver pedidos cuya fecha no pudo convertirse en el ETL.
SELECT
    CAST(date_trunc('month', order_date) AS date) AS month,
    status,
    channel,
    currency,
    count(*) AS order_count,
    count(total_amount) AS orders_with_amount,
    sum(total_amount) AS ordered_amount,
    avg(total_amount) AS average_order_amount
FROM mercadoya_analytics_demo_curated.orders
GROUP BY 1, 2, 3, 4
ORDER BY month NULLS LAST, status, channel, currency;
