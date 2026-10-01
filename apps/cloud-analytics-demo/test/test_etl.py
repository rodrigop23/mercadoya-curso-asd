"""Pruebas con Spark 3.5.4, sin AWS. Ejecutar con el comando Docker del README."""

import csv
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from pyspark.sql import SparkSession


APP = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("etl", APP / "glue/scripts/etl.py")
etl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(etl)


class EtlTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spark = (
            SparkSession.builder.master("local[2]")
            .appName("mercadoya-etl-local-test")
            .config("spark.ui.enabled", "false")
            .config("spark.sql.shuffle.partitions", "2")
            .getOrCreate()
        )
        cls.spark.sparkContext.setLogLevel("ERROR")
        cls.spark.conf.set("spark.sql.session.timeZone", "UTC")
        cls.spark.conf.set("spark.sql.ansi.enabled", "false")
        cls.spark.conf.set("spark.sql.legacy.timeParserPolicy", "CORRECTED")

    @classmethod
    def tearDownClass(cls):
        cls.spark.stop()

    def test_normalizes_missing_values_dates_status_and_precise_money(self):
        columns = list(etl.TABLE_SCHEMAS["orders"])
        frame = self.spark.createDataFrame([
            (" ORDER-1 ", " CUSTOMER-1 ", "2026-09-17T13:13:45Z", " Canceled ", "0.10", " pen ", " WEB "),
            ("order-2", "customer-2", "invalid-date", " N/A ", "bad-price", "PEN", "api"),
            ("order-3", "customer-3", "2026-09-18T02:00:00+02:00", "Not A Status", "NULL", "PEN", "api"),
        ], columns)
        normalized = etl.normalize(frame, "orders")
        rows = normalized.collect()
        self.assertEqual(rows[0].order_id, "order-1")
        self.assertEqual(rows[0].customer_id, "customer-1")
        self.assertEqual(rows[0].status, "cancelled")
        self.assertEqual(str(rows[0].total_amount), "0.10")
        self.assertEqual(rows[0].currency, "PEN")
        self.assertEqual(rows[0].channel, "web")
        self.assertEqual(rows[0].order_date.isoformat(), "2026-09-17T13:13:45")
        self.assertIsNone(rows[1].order_date)
        self.assertIsNone(rows[1].total_amount)
        self.assertEqual(rows[1].status, "unknown")
        self.assertEqual(rows[2].order_date.isoformat(), "2026-09-18T00:00:00")
        self.assertEqual(rows[2].status, "unknown")
        self.assertIsNone(rows[2].total_amount)
        self.assertEqual(normalized.schema["total_amount"].dataType.simpleString(), "decimal(18,2)")

    def test_keeps_unpaid_timestamps_null_and_normalizes_payment_status(self):
        frame = self.spark.createDataFrame([
            (" PAYMENT-1 ", " ORDER-1 ", "12.34", "pen", " CANCELLED ", " POLAR ", "ref-1", "2026-09-01T03:00:00Z", ""),
        ], list(etl.TABLE_SCHEMAS["payments"]))
        payment = etl.normalize(frame, "payments").first()
        self.assertEqual(payment.status, "canceled")
        self.assertEqual(payment.provider, "polar")
        self.assertIsNone(payment.paid_at)

    def test_rejects_unexpected_csv_headers(self):
        with tempfile.TemporaryDirectory() as directory:
            raw = Path(directory) / "orders"
            raw.mkdir()
            (raw / "orders.csv").write_text("col1,col2\na,b\n")
            with self.assertRaisesRegex(ValueError, "cabecera esperada"):
                etl.read_csv(self.spark, directory, "orders")

    def test_all_seed_tables_roundtrip_to_parquet_without_losing_rows_or_types(self):
        with tempfile.TemporaryDirectory() as directory:
            raw, curated = Path(directory) / "raw", Path(directory) / "curated"
            counts = {}
            for table in etl.TABLE_SCHEMAS:
                source = APP / f"seed/raw/{table}.csv"
                with source.open(newline="") as handle:
                    counts[table] = sum(1 for _ in csv.DictReader(handle))
                target = raw / table / f"{table}.csv"
                target.parent.mkdir(parents=True)
                target.write_bytes(source.read_bytes())
            etl.run(self.spark, str(raw), str(curated))
            evidence = {"sparkVersion": self.spark.version, "tables": {}}
            for table, schema in etl.TABLE_SCHEMAS.items():
                output = self.spark.read.parquet(str(curated / table))
                self.assertEqual(output.count(), counts[table], table)
                self.assertEqual({field.name: field.dataType.simpleString() for field in output.schema}, schema)
                files = list((curated / table).glob("*.parquet"))
                self.assertEqual(len(files), 1, table)
                self.assertFalse((curated / table / "_SUCCESS").exists())
                evidence["tables"][table] = {"rows": counts[table], "schema": schema,
                    "destination": f"curated/{table}/", "file": files[0].name}
            orders = etl.normalize(etl.read_csv(self.spark, str(raw), "orders"), "orders")
            etl.write_parquet(orders, str(curated), "orders")
            self.assertEqual(self.spark.read.parquet(str(curated / "orders")).count(), counts["orders"])
            customers = self.spark.read.parquet(str(curated / "customers"))
            self.assertGreater(customers.filter("city IS NULL").count(), 0)
            products = self.spark.read.parquet(str(curated / "products"))
            self.assertGreater(products.filter("category IS NULL").count(), 0)
            orders = self.spark.read.parquet(str(curated / "orders"))
            self.assertGreater(orders.filter("status = 'unknown'").count(), 0)
            self.assertGreater(orders.filter("total_amount IS NULL").count(), 0)
            output_path = APP / "cdk.out/local-etl-evidence.json"
            output_path.parent.mkdir(exist_ok=True)
            output_path.write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    unittest.main(verbosity=2)
