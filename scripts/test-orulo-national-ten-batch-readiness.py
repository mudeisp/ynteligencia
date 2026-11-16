#!/usr/bin/env python3
"""Offline tests for ten-lot preflight. No Supabase credentials or writes."""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import unittest
from unittest.mock import patch

PATH = pathlib.Path(__file__).with_name("orulo-national-ten-batch-readiness.py")
SPEC = importlib.util.spec_from_file_location("orulo_ten_readiness", PATH)
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

class TenLotPreflightTests(unittest.TestCase):
    def test_boundary_assignment_covers_each_lot(self):
        with patch.object(mod, "TOTAL_PATCHES", 10):
            self.assertEqual([mod.classify_lot(i, 1) for i in range(10)], list(range(1,11)))

    def test_midpoint_keeps_large_property_whole(self):
        with patch.object(mod, "TOTAL_PATCHES", 100):
            self.assertEqual(mod.classify_lot(0, 20), 2)
            self.assertEqual(mod.classify_lot(20, 20), 4)
            self.assertEqual(mod.classify_lot(95, 5), 10)

    def test_read_only_lot_selector_and_candidate_count(self):
        original = (mod.TOTAL_TARGETS, mod.TOTAL_PATCHES)
        try:
            mod.TOTAL_TARGETS = mod.TOTAL_PATCHES = 10
            rows = [
                f"00000000-0000-0000-0000-{i:012d}\t1\t"
                + ("t\t1\t0\t0\t0" if i == 2 else
                   "f\t0\t1\t0\t0" if i == 3 else
                   "f\t0\t0\t1\t0")
                for i in range(1,11)
            ]
            def source(sql):
                if sql.strip().startswith("SELECT COALESCE(MAX(sequence),0)"):
                    return ["6241\t" + mod.HEAD + "\t1\t0\t10"]
                if "ORDER BY id" in sql:
                    return rows
                raise AssertionError("Unexpected query")
            for selected, expected in (("1", 1), ("all", 10)):
                stream = io.StringIO()
                with patch.dict(os.environ, {"ORULO_SELECTED_LOT": selected}, clear=True):
                    with patch.object(mod, "psql", side_effect=source):
                        with contextlib.redirect_stdout(stream):
                            mod.main()
                data = json.loads(stream.getvalue())
                self.assertEqual(data["executionPermitted"], False)
                self.assertEqual(data["lotExecutionEnabled"], False)
                self.assertEqual(data["selectedLot"], selected)
                self.assertEqual(len(data["lots"]), expected)
                self.assertEqual(data["lots"][0]["properties"], 1)
                self.assertEqual(data["lots"][0]["original_baseline_candidate"], 1)
                if selected == "all":
                    self.assertEqual(data["lots"][1]["divergent_complete"], 1)
                    self.assertEqual(data["lots"][2]["original_baseline_blocked"], 1)
        finally:
            mod.TOTAL_TARGETS, mod.TOTAL_PATCHES = original

    def test_invalid_lot_rejected_before_select(self):
        with patch.dict(os.environ, {"ORULO_SELECTED_LOT": "11"}):
            with patch.object(mod, "psql", side_effect=lambda x: ["6241\t"+mod.HEAD+"\t1\t0\t5684"]):
                with self.assertRaisesRegex(RuntimeError, "LOT_SELECTION_INVALID"):
                    mod.main()

if __name__ == "__main__":
    unittest.main()
