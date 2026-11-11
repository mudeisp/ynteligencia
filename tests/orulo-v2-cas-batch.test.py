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

    def test_replay_rejects_unrelated_record_change(self):
        items = [self.item("1"), self.item("3")]
        self.assertEqual(self.apply(items), 2)
        self.conn.execute("UPDATE public.properties SET raw_data=raw_data || '{\"unrelated\":true}'::jsonb")
        changed = self.record()
        with self.assertRaisesRegex(psycopg.Error, "CAS_BATCH_CONFLICT"):
            self.apply(items)
        self.assertEqual(self.record(), changed)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM orulo_recovery.cas_batch_audit").fetchone()[0], 2)

    def test_trigger_change_rolls_back_property_and_audit(self):
        self.conn.execute("""
            CREATE FUNCTION public.test_cas_change() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN NEW.external_id := 'orulo:10:changed'; RETURN NEW; END $$;
            CREATE TRIGGER test_cas_change BEFORE UPDATE ON public.properties
            FOR EACH ROW EXECUTE FUNCTION public.test_cas_change();
        """)
        try:
            with self.assertRaisesRegex(psycopg.Error, "CAS_UNAUTHORIZED_TRIGGER_CHANGE"):
                self.apply([self.item("1")])
            self.assertEqual(self.record(), self.baseline)
            self.assertEqual(self.conn.execute("SELECT count(*) FROM orulo_recovery.cas_batch_audit").fetchone()[0], 0)
        finally:
            self.conn.execute("DROP FUNCTION public.test_cas_change() CASCADE")

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


    def test_pilot_five_occurrences_and_audit_readback(self):
        """Five occurrence pilot on disposable PostgreSQL, never production."""
        import uuid
        original = self.record()
        property_ids = [ID] + [str(uuid.uuid4()) for _ in range(4)]
        for pid in property_ids[1:]:
            self.conn.execute(
                "INSERT INTO public.properties VALUES (%s, 'novos', 'orulo:10:test', %s)",
                (pid, Jsonb(original["raw_data"])),
            )
        items = []
        for pid in property_ids:
            baseline = self.conn.execute(
                "SELECT to_jsonb(p) FROM public.properties p WHERE id=%s", (pid,)
            ).fetchone()[0]
            items.append({"property_id": pid, "building_id": "10", "plan_id": "1",
                          "baseline": baseline, "images": [URL]})
        self.assertEqual(self.apply(items), 5)
        for pid in property_ids:
            after = self.conn.execute(
                "SELECT to_jsonb(p) FROM public.properties p WHERE id=%s", (pid,)
            ).fetchone()[0]
            before = next(item["baseline"] for item in items if item["property_id"] == pid)
            self.assertEqual(after["raw_data"]["building"]["floor_plans"][0]["images"], [URL])
            restored = dict(after)
            restored["raw_data"] = dict(after["raw_data"])
            restored["raw_data"]["building"] = dict(after["raw_data"]["building"])
            restored["raw_data"]["building"]["floor_plans"] = [
                dict(p) for p in after["raw_data"]["building"]["floor_plans"]
            ]
            restored["raw_data"]["building"]["floor_plans"][0].pop("images")
            self.assertEqual(restored, before)
        self.assertEqual(self.conn.execute(
            "SELECT count(*) FROM orulo_recovery.cas_batch_audit"
        ).fetchone()[0], 5)
        audit = self.conn.execute("""
            SELECT a.property_id::text, a.baseline_sha256, a.result_sha256,
                   encode(sha256(convert_to(to_jsonb(p)::text, 'UTF8')), 'hex')
            FROM orulo_recovery.cas_batch_audit a
            JOIN public.properties p ON p.id = a.property_id
            ORDER BY a.property_id
        """).fetchall()
        self.assertEqual(len(audit), 5)
        links = self.conn.execute("""
            SELECT previous_entry_sha256, entry_sha256,
                   encode(sha256(convert_to(
                     concat_ws('|', transaction_id::text, property_id::text,
                       building_id, plan_id, baseline_sha256, result_sha256,
                       previous_entry_sha256), 'UTF8')), 'hex')
            FROM orulo_recovery.cas_batch_audit
            ORDER BY property_id, building_id, plan_id
        """).fetchall()
        previous = "0" * 64
        for prev_hash, entry_hash, recomputed in links:
            self.assertEqual(prev_hash, previous)
            self.assertEqual(entry_hash, recomputed)
            previous = entry_hash
        for pid, before_hash, after_hash, live_hash in audit:
            self.assertEqual(after_hash, live_hash)
            self.assertRegex(before_hash, r"^[0-9a-f]{64}$")
            self.assertRegex(after_hash, r"^[0-9a-f]{64}$")
            self.assertNotEqual(before_hash, after_hash)
        self.assertEqual(self.apply(items), 0)
        self.assertEqual(self.conn.execute(
            "SELECT count(*) FROM orulo_recovery.cas_batch_audit"
        ).fetchone()[0], 5)

    def test_pilot_stale_baseline_rolls_back_all_five(self):
        import uuid
        items = [self.item("1")]
        for _ in range(4):
            pid = str(uuid.uuid4())
            self.conn.execute(
                "INSERT INTO public.properties VALUES (%s, 'novos', 'orulo:10:test', %s)",
                (pid, Jsonb(self.baseline["raw_data"])),
            )
            baseline = self.conn.execute(
                "SELECT to_jsonb(p) FROM public.properties p WHERE id=%s", (pid,)
            ).fetchone()[0]
            items.append({"property_id": pid, "building_id": "10", "plan_id": "1",
                          "baseline": baseline, "images": [URL]})
        items[-1]["baseline"] = {**items[-1]["baseline"], "external_id": "orulo:10:stale"}
        with self.assertRaisesRegex(psycopg.Error, "CAS_BATCH_CONFLICT"):
            self.apply(items)
        self.assertEqual(self.conn.execute(
            "SELECT count(*) FROM orulo_recovery.cas_batch_audit"
        ).fetchone()[0], 0)
        self.assertEqual(self.conn.execute(
            "SELECT count(*) FROM public.properties WHERE raw_data #> '{building,floor_plans,0,images}' IS NOT NULL"
        ).fetchone()[0], 0)

    def test_pilot_duplicate_plan_id_is_blocked(self):
        duplicated = dict(self.baseline["raw_data"])
        duplicated["building"] = {"floor_plans": [{"id": "1"}, {"id": "1"}]}
        self.conn.execute("UPDATE public.properties SET raw_data=%s WHERE id=%s",
                          (Jsonb(duplicated), ID))
        current = self.record()
        item = self.item("1")
        item["baseline"] = current
        with self.assertRaisesRegex(psycopg.Error, "CAS_BATCH_CONFLICT"):
            self.apply([item])
        self.assertEqual(self.record(), current)

if __name__ == "__main__":
    unittest.main()
