# Validación del prompt 03

Ejecución real completada el 1 de octubre de 2026, a las 14:52 de Lima, en la cuenta `902311297707`, región `us-east-1`. `CloudAnalyticsDemoStack` quedó en `CREATE_COMPLETE`. Se desplegó el scaffold existente y se ejecutó su semilla con Glue 5.0 antes de consultar Athena.

## Catálogo y datos consultados

Las consultas usaron `AwsDataCatalog`, DB `mercadoya_analytics_demo_curated` y workgroup `mercadoya-cloud-analytics-demo`, con engine v3. Se verificaron las ubicaciones del catálogo, la clasificación y el input format Parquet. La consulta `00_verify_curated.sql` confirmó con `$path` que las filas provienen de archivos `.snappy.parquet` bajo:

```text
s3://cloudanalyticsdemostack-curatedbucket6a59c97e-jhpqxorwpo3i/curated/<tabla>/
```

| Tabla curated         | Filas verificadas en Athena |
| --------------------- | --------------------------: |
| `customers`           |                         800 |
| `products`            |                         120 |
| `orders`              |                       3.500 |
| `order_items`         |                      10.507 |
| `inventory_snapshots` |                         480 |
| `payments`            |                       3.382 |

Los conteos coinciden con las seis CSV locales. `order_date` es `timestamp`; `total_amount`, `price`, `unit_price`, `line_total` y `payments.amount` son `decimal(18,2)`. Se verificaron también las columnas `status`, `channel`, `category`, `segment` y `city`. La consulta de control encontró cero estados de pedidos fuera de `confirmed|pending|rejected|cancelled|shipped|unknown`. Todas las consultas SQL de este recorrido leyeron la DB curated.

Los dos crawlers y el job ETL terminaron con éxito. El job fue `jr_809ad1b46fbc981e818064ae05f1d689b7d7a6279ae9db93fdc3cdb9469c1c53`. Para permitir el despliegue, se corrigieron los targets de los crawlers a carpetas por tabla y se usó `CombineCompatibleSchemas` sin un nivel absoluto de tabla.

## Consultas y resultados

| SQL versionado                                                     | QueryExecutionId                       | Estado      | Filas de resultado |
| ------------------------------------------------------------------ | -------------------------------------- | ----------- | -----------------: |
| [Control de curated](./00_verify_curated.sql)                      | `8e9dd1ee-bb2a-4ea0-a156-6d555e9bf699` | `SUCCEEDED` |                  6 |
| [Pedidos por mes, estado y canal](./01_orders_by_month_status.sql) | `00836722-bb80-42be-9ef5-e62a91e93aa2` | `SUCCEEDED` |                 54 |
| [Ventas por segmento y ciudad](./02_revenue_by_segment.sql)        | `00291ac4-5236-4115-93df-f9be8313c0fe` | `SUCCEEDED` |                180 |
| [Top productos](./03_top_products.sql)                             | `20a10d40-654f-47b8-801f-251752a4499f` | `SUCCEEDED` |                 10 |

El workgroup impone cifrado SSE-S3 y el siguiente `AthenaResultsLocation`. Cada resultado es `<QueryExecutionId>.csv` bajo este prefijo. `GetQueryExecution` confirmó la ubicación y `HeadObject` confirmó que los cuatro CSV existen y tienen contenido.

```text
s3://cloudanalyticsdemostack-artifactsbucket2aac5544-bvme6cvpbkpl/athena-results/
```

Una comparación independiente con las CSV locales confirmó los conteos, cobertura de importes y sumas de los 54 grupos de pedidos y los 180 grupos de segmento y ciudad. También confirmó los diez productos y sus importes, unidades, número de pedidos y cobertura de líneas. No se consultó la DB raw para hacer esa comparación.

La semilla contiene pedidos del 18 de julio al 30 de septiembre de 2026 en UTC. Las filas agregadas cubren 3.500 pedidos, de los cuales 3.486 tienen importe. Los 2.571 pedidos `confirmed` o `shipped` suman S/ 6.790.760,56. El join con clientes conserva ese conteo y ese importe. Son ventas de pedidos, no cobros conciliados con pagos.

El primer producto del ranking es "Max Filtro 197", categoría Electrónica, con S/ 455.935,54 en líneas, 198 unidades y 77 pedidos. Su precio de catálogo es S/ 2.308,41. La consulta permite explicar en clase la diferencia entre precio de catálogo e importe vendido.

El [README](../README.md#athena-y-datamart-mínimo-prompt-03) relaciona cada métrica con sus tablas y la visualización posterior en QuickSight, e incluye la navegación de consola y las referencias oficiales de Athena verificadas el 1 de octubre de 2026.

## Evidencia y repetición

Los archivos locales de evidencia están bajo `cdk.out/`, ignorado por Git:

- `outputs.json` contiene los outputs del despliegue.
- `glue-demo-evidence.json` contiene ejecuciones de crawlers, job, esquemas, archivos Parquet y conteos.
- `athena-demo-evidence.json` contiene SQL, IDs, resultados completos, rutas S3 y estadísticas de las cuatro consultas.
- `athena-seed-expectations.json` y `athena-reconciliation.json` contienen la referencia local y los controles de métricas de esta ejecución.

Para volver a ejecutar las consultas sobre el curated actual, desde `apps/cloud-analytics-demo`:

```bash
pnpm demo:athena cdk.out/outputs.json
```

Pasaron `typecheck`, las 15 pruebas de plantilla y del comando, la síntesis del despliegue y la revisión de formato. `lint` terminó con una advertencia previa por el import sin uso `randomUUID` en `seed/generate.mjs`.

Las consultas reales usaron la sesión administrativa del docente. `AthenaQueryPolicyArn` sigue disponible como política opcional para una identidad con permisos acotados; este recorrido no la adjuntó a otra identidad.
