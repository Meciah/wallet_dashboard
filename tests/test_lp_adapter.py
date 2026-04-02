from __future__ import annotations

import unittest
from decimal import Decimal

from portfolio_tracker.adapters.lp_tokens import LpTokenAdapter
from portfolio_tracker.config import KNOWN_LP_MINTS
from portfolio_tracker.providers import TokenBalance


class FakeChainProvider:
    def get_sol_balance(self, wallet_address: str) -> Decimal:
        return Decimal("0")

    def get_token_balances(self, wallet_address: str) -> list[TokenBalance]:
        known_lp_mint = next(iter(KNOWN_LP_MINTS))
        return [
            TokenBalance(mint=known_lp_mint, amount=Decimal("3.5"), decimals=9),
            TokenBalance(mint="SomeOtherMint", amount=Decimal("8"), decimals=6),
        ]


class FakePriceProvider:
    def get_price_usd(self, mint: str):
        known_lp_mint = next(iter(KNOWN_LP_MINTS))
        if mint == known_lp_mint:
            return Decimal("4")
        return None


class LpAdapterTests(unittest.TestCase):
    def test_lp_adapter_only_emits_allowlisted_lp_tokens(self) -> None:
        adapter = LpTokenAdapter(FakeChainProvider(), FakePriceProvider())
        positions = adapter.collect_positions("wallet")

        self.assertEqual(1, len(positions))
        self.assertEqual("lp", positions[0].position_type)
        self.assertEqual(14.0, positions[0].usd_value)


if __name__ == "__main__":
    unittest.main()
