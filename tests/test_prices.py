from __future__ import annotations

import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from portfolio_tracker.db import apply_schema, db_session, list_latest_prices, upsert_price
from portfolio_tracker.providers import FallbackPriceProvider, StaticPriceProvider


class FailingPriceProvider:
    def get_price_usd(self, mint: str):
        raise RuntimeError("boom")


class PriceTests(unittest.TestCase):
    def test_fallback_price_provider_uses_next_provider(self) -> None:
        provider = FallbackPriceProvider([FailingPriceProvider(), StaticPriceProvider({"mint1": Decimal("42")})])
        self.assertEqual(Decimal("42"), provider.get_price_usd("mint1"))

    def test_latest_prices_query_returns_newest_per_mint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "test.db"
            schema_path = Path("src/portfolio_tracker/schema.sql")
            with db_session(db_path) as conn:
                apply_schema(conn, schema_path)
                upsert_price(conn, "mint1", 1.0, "s")
                upsert_price(conn, "mint1", 2.0, "s")
                upsert_price(conn, "mint2", 5.0, "s")
                prices = list_latest_prices(conn)

            by_mint = {item["mint"]: item["price_usd"] for item in prices}
            self.assertEqual(2.0, by_mint["mint1"])
            self.assertEqual(5.0, by_mint["mint2"])


if __name__ == "__main__":
    unittest.main()
