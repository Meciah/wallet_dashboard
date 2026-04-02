from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from portfolio_tracker.db import (
    apply_schema,
    db_session,
    list_current_positions,
    list_portfolio_history,
    save_portfolio_snapshot,
    seed_wallets_and_protocols,
    upsert_current_position,
)
from portfolio_tracker.models import PortfolioSummary, Position, QuantityComponent


class DbQueryTests(unittest.TestCase):
    def test_position_and_history_queries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "test.db"
            schema_path = Path("src/portfolio_tracker/schema.sql")

            with db_session(db_path) as conn:
                apply_schema(conn, schema_path)
                seed_wallets_and_protocols(conn)
                upsert_current_position(
                    conn,
                    Position(
                        wallet_address="3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R",
                        protocol="wallet_tokens",
                        position_type="wallet_balance",
                        position_key="k1",
                        quantity=[QuantityComponent(mint="So11111111111111111111111111111111111111112", symbol="SOL", amount=1.0)],
                        usd_value=123.0,
                        raw={"source": "test"},
                    ),
                )
                save_portfolio_snapshot(conn, PortfolioSummary(scope="wallet_1", total_usd=123.0))

            with db_session(db_path) as conn:
                positions = list_current_positions(conn, "wallet_1")
                history = list_portfolio_history(conn, "wallet_1", limit=5)

            self.assertEqual(1, len(positions))
            self.assertEqual("wallet_1", positions[0]["wallet_label"])
            self.assertEqual(123.0, positions[0]["usd_value"])
            self.assertEqual(1, len(history))
            self.assertEqual(123.0, history[0]["total_usd"])


if __name__ == "__main__":
    unittest.main()
