from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from portfolio_tracker.db import (
    apply_schema,
    db_session,
    list_allocation,
    seed_wallets_and_protocols,
    upsert_current_position,
)
from portfolio_tracker.models import Position, QuantityComponent


class AllocationTests(unittest.TestCase):
    def test_allocation_grouping(self) -> None:
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
                        position_key="a1",
                        quantity=[QuantityComponent(mint="m1", symbol="A", amount=1.0)],
                        usd_value=25.0,
                        raw={},
                    ),
                )
                upsert_current_position(
                    conn,
                    Position(
                        wallet_address="ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
                        protocol="marinade",
                        position_type="staking",
                        position_key="a2",
                        quantity=[QuantityComponent(mint="m2", symbol="B", amount=1.0)],
                        usd_value=75.0,
                        raw={},
                    ),
                )
                protocol_alloc = list_allocation(conn, "combined", by="protocol")
                wallet_alloc = list_allocation(conn, "combined", by="wallet")

            self.assertEqual("marinade", protocol_alloc[0]["protocol"])
            self.assertEqual(75.0, protocol_alloc[0]["total_usd"])
            labels = {row["wallet"] for row in wallet_alloc}
            self.assertIn("wallet_1", labels)
            self.assertIn("wallet_2", labels)


if __name__ == "__main__":
    unittest.main()
