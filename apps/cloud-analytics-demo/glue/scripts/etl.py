"""ETL didactico de las seis CSV seed a Parquet. El crawler registra el catalogo."""

import json
import sys

from pyspark.sql import DataFrame, SparkSession, functions as F


TABLE_SCHEMAS = {
    "customers": {
        "customer_id": "string",
        "signup_date": "date",
        "city": "string",
        "segment": "string",
        "email": "string",
    },
    "products": {
        "product_id": "string",
        "title": "string",
        "category": "string",
        "price": "decimal(18,2)",
        "stock": "int",
        "stock_status": "string",
        "currency": "string",
    },
    "orders": {
        "order_id": "string",
        "customer_id": "string",
        "order_date": "timestamp",
        "status": "string",
        "total_amount": "decimal(18,2)",
        "currency": "string",
        "channel": "string",
    },
    "order_items": {
        "order_item_id": "string",
        "order_id": "string",
        "product_id": "string",
        "quantity": "int",
        "unit_price": "decimal(18,2)",
        "line_total": "decimal(18,2)",
    },
    "inventory_snapshots": {
        "snapshot_id": "string",
        "product_id": "string",
        "snapshot_date": "date",
        "quantity_on_hand": "int",
        "quantity_reserved": "int",
        "quantity_available": "int",
        "warehouse": "string",
    },
    "payments": {
        "payment_id": "string",
        "order_id": "string",
        "amount": "decimal(18,2)",
        "currency": "string",
        "status": "string",
        "provider": "string",
        "provider_ref": "string",
        "created_at": "timestamp",
        "paid_at": "timestamp",
    },
}

STATUS_VALUES = {
    "orders": ["confirmed", "pending", "rejected", "cancelled", "shipped"],
    "payments": ["succeeded", "failed", "pending", "canceled"],
    "products": ["out_of_stock", "low", "ok", "high"],
}


def read_csv(spark: SparkSession, location: str, table: str) -> DataFrame:
    # Leer strings evita que la inferencia convierta importes a doubles o pierda IDs.
    frame = (
        spark.read.option("header", "true")
        .option("inferSchema", "false")
        .option("mode", "FAILFAST")
        .option("encoding", "UTF-8")
        .option("escape", '"')
        .csv(f"{location.rstrip('/')}/{table}/{table}.csv")
    )
    expected = list(TABLE_SCHEMAS[table])
    if frame.columns != expected:
        raise ValueError(f"{table}: cabecera esperada {expected}, recibida {frame.columns}")
    return frame


def normalize(frame: DataFrame, table: str) -> DataFrame:
    schema = TABLE_SCHEMAS[table]
    columns = []
    for name, data_type in schema.items():
        value = F.trim(F.col(name).cast("string"))
        value = F.when(F.lower(value).isin("", "null", "none", "n/a"), None).otherwise(value)
        if name.endswith("_id") or name in {"email", "segment", "channel", "provider"}:
            value = F.lower(value)
        if name in {"currency", "warehouse"}:
            value = F.upper(value)
        if name in {"status", "stock_status"}:
            value = F.regexp_replace(F.lower(value), r"[\s-]+", "_")
            if table == "orders":
                value = F.when(value == "canceled", "cancelled").otherwise(value)
            elif table == "payments":
                value = F.when(value == "cancelled", "canceled").otherwise(value)
            value = F.when(value.isin(STATUS_VALUES[table]), value).otherwise(F.lit("unknown"))
        columns.append(value.cast(data_type).alias(name))
    return frame.select(*columns)


def write_parquet(frame: DataFrame, location: str, table: str) -> str:
    target = f"{location.rstrip('/')}/{table}/"
    # Un archivo por tabla basta para la semilla. No se usa un sink de Data Catalog.
    frame.coalesce(1).write.mode("overwrite").option("compression", "snappy").parquet(target)
    return target


def run(spark: SparkSession, raw_location: str, curated_location: str) -> None:
    spark.conf.set("spark.sql.session.timeZone", "UTC")
    # Casts de datos invalidos producen NULL; la validacion no inventa importes ni fechas.
    spark.conf.set("spark.sql.ansi.enabled", "false")
    spark.conf.set("spark.sql.legacy.timeParserPolicy", "CORRECTED")
    spark.sparkContext._jsc.hadoopConfiguration().set(
        "mapreduce.fileoutputcommitter.marksuccessfuljobs", "false"
    )
    for table in TABLE_SCHEMAS:
        frame = normalize(read_csv(spark, raw_location, table), table).cache()
        try:
            count = frame.count()
            if count == 0:
                raise ValueError(f"{table}: la semilla no puede estar vacia")
            target = write_parquet(frame, curated_location, table)
            print(json.dumps({"table": table, "rows": count, "path": target,
                              "schema": frame.schema.simpleString()}), flush=True)
        finally:
            frame.unpersist()


def main() -> None:
    from awsglue.context import GlueContext
    from awsglue.utils import getResolvedOptions
    from pyspark.context import SparkContext

    args = getResolvedOptions(sys.argv, ["RAW_LOCATION", "CURATED_LOCATION"])
    glue_context = GlueContext(SparkContext.getOrCreate())
    # Bookmarks off: no Job.init/commit, que requieren permisos de bookmarks.
    run(glue_context.spark_session, args["RAW_LOCATION"], args["CURATED_LOCATION"])


if __name__ == "__main__":
    main()
