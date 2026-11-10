import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
import unittest

import psycopg
from psycopg.types.json import Jsonb

ID = "d59d2bef-c9ba-4117-9268-d64a9b3f078a"
URL = "https://static.orulo.com.br/images/test.png"
DSN = os.environ["TEST_DATABASE_URL"]
assert DSN == "postgresql://postgres:test@localhost:5432/postgres"


class BatchTest(unittest.TestCase):
    def setUp(self):
        self.conn = psycopg.connect(DSN, autocommit=True)
        self.addCleanup(self.conn.close)
        self.conn.execute("DROP TABLE IF EXISTS public.properties CASCADE")
        self.conn.execute("""
            CREATE TABLE public.properties (
                id uuid PRIMARY KEY, source text, external_id text, raw_data jsonb
            )
        """)
        self.conn.execute(Path("sql/orulo-v2-cas-replace-existing-plan.sql").read_text(encoding="utf-8"))
        self.conn.execute("TRUNCATE orulo_recovery.cas_batch_audit")
        self.conn.execute("INSERT INTO public.properties VALUES (%s, 'novos', 'orulo:10:test', %s)",
                          (ID, Jsonb({"building_id": "10", "building": {"floor_plans": [
                              {"id": "1"}, {"id": "2", "image_url": URL}, {"id": "3"}
                          ]}})))
        self.baseline = self.record()

    def record(self):
        return self.conn.execute("SELECT to_jsonb(p) FROM public.properties p").fetchone()[0]

    def item(self, plan_id):
        return {"property_id": ID, "building_id": "10", "plan_id": plan_id,
                "baseline": self.baseline, "images": [URL]}

    def apply(self, items, conn=None):
        return (conn or self.conn).execute(
            "SELECT orulo_recovery.cas_apply_batch(%s)", (Jsonb(items),)
        ).fetchone()[0]

    def test_atomic_rollback_and_alternative_preservation(self):
        with self.assertRaisesRegex(psycopg.Error, "CAS_BATCH_CONFLICT"):
            self.apply([self.item("1"), self.item("2")])
        self.assertEqual(self.record(), self.baseline)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM orulo_recovery.cas_batch_audit").fetchone()[0], 0)

    def test_two_plans_same_record_and_replay(self):
        items = [self.item("1"), self.item("3")]
        self.assertEqual(self.apply(items), 2)
        after = self.record()
        self.assertEqual(self.apply(items), 0)
        self.assertEqual(self.record(), after)

    def test_competing_transactions(self):
        barrier = Barrier(2, timeout=10)

        def apply_concurrently(plan_id):
            with psycopg.connect(DSN, connect_timeout=5) as conn:
                conn.execute("SET LOCAL lock_timeout = '10s'")
                barrier.wait()
                try:
                    return self.apply([self.item(plan_id)], conn)
                except psycopg.Error as error:
                    if error.diag.message_primary != "CAS_BATCH_CONFLICT":
                        raise
                    return 0

        with ThreadPoolExecutor(2) as pool:
            self.assertCountEqual(pool.map(apply_concurrently, ["1", "3"]), [1, 0])


if __name__ == "__main__":
    unittest.main()
