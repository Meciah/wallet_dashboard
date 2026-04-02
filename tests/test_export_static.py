from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from portfolio_tracker.db import apply_schema, db_session, save_portfolio_snapshot, seed_wallets_and_protocols
from portfolio_tracker.export_static import export_static_json
from portfolio_tracker.models import PortfolioSummary


class ExportStaticTests(unittest.TestCase):
    def test_export_writes_portfolio_data_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "portfolio.db"
            out_dir = Path(tmp) / "out"

            with db_session(db_path) as conn:
                apply_schema(conn, Path("src/portfolio_tracker/schema.sql"))
                seed_wallets_and_protocols(conn)
                save_portfolio_snapshot(conn, PortfolioSummary(scope="combined", total_usd=42.0))

            export_static_json(db_path, out_dir)

            output_file = out_dir / "portfolio-data.json"
            self.assertTrue(output_file.exists())
            payload = json.loads(output_file.read_text())
            self.assertIn("summary", payload)
            self.assertIn("combined", payload["summary"])


if __name__ == "__main__":
    unittest.main()
