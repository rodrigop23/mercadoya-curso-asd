# cloud-analytics-demo

Demo aislado para **Sesión 6** (arquitectura de datos y analítica):

**CSV semilla → S3 (raw) → Glue Crawler → Glue Job ETL → S3 (curated, Parquet) → Glue Data Catalog → Athena → QuickSight**

Patrón similar a `cloud-pipeline-demo`: este paquete no es importado por los servicios operativos de MercadoYa.

## Estado actual

- **Listo:** dataset semilla CSV en `seed/raw/` + generador reproducible (`seed/generate.mjs`).
- **Pendiente:** stack CDK (S3, Glue, Athena, IAM). QuickSight se configura principalmente desde la consola.

## Dataset semilla

Ver [`seed/README.md`](./seed/README.md) para schema, regeneración y KPIs de ejemplo.

```bash
node apps/cloud-analytics-demo/seed/generate.mjs
```

## Relación con MercadoYa

Los CSV tienen *forma* de dominio MercadoYa (productos, pedidos, pagos Polar-ish, stock) pero son datos sintéticos. No leen ni escriben Postgres/NATS de Catalog, Orders o Inventory.
