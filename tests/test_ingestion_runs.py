from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from portfolio_tracker.db import (
    apply_schema,
    db_session,
    finish_ingestion_run,
    list_ingestion_runs,
    start_ingestion_run,
)


class IngestionRunTests(unittest.TestCase):
    def test_ingestion_runs_list(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "test.db"
            schema_path = Path("src/portfolio_tracker/schema.sql")
            with db_session(db_path) as conn:
                apply_schema(conn, schema_path)
                run_id = start_ingestion_run(conn)
                finish_ingestion_run(conn, run_id, status="success", error_count=0, notes="ok")
                rows = list_ingestion_runs(conn, limit=5)

            self.assertEqual(1, len(rows))
            self.assertEqual("success", rows[0]["status"])
            self.assertEqual(0, rows[0]["error_count"])


if __name__ == "__main__":
    unittest.main()
