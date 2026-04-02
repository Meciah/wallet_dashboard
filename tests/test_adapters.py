from __future__ import annotations

import unittest
from decimal import Decimal

from portfolio_tracker.adapters.marinade import MarinadeAdapter
from portfolio_tracker.adapters.wallet_tokens import WalletTokenAdapter
from portfolio_tracker.config import MSOL_MINT
from portfolio_tracker.providers import TokenBalance


class FakeChainProvider:
    def get_sol_balance(self, wallet_address: str) -> Decimal:
        return Decimal("1.5")

    def get_token_balances(self, wallet_address: str) -> list[TokenBalance]:
        return [
            TokenBalance(mint=MSOL_MINT, amount=Decimal("2.25"), decimals=9),
            TokenBalance(mint="TokenMint123", amount=Decimal("5"), decimals=6, symbol="TKX"),
        ]


class FakePriceProvider:
    def get_price_usd(self, mint: str):
        prices = {
            "So11111111111111111111111111111111111111112": Decimal("100"),
            MSOL_MINT: Decimal("120"),
            "TokenMint123": Decimal("2"),
        }
        return prices.get(mint)


class AdapterTests(unittest.TestCase):
    def test_wallet_token_adapter_returns_sol_and_tokens(self) -> None:
        adapter = WalletTokenAdapter(FakeChainProvider(), FakePriceProvider())
        positions = adapter.collect_positions("wallet")

        self.assertEqual(3, len(positions))
        total = sum(position.usd_value for position in positions)
        self.assertEqual(430.0, total)

    def test_marinade_adapter_only_returns_msol_position(self) -> None:
        adapter = MarinadeAdapter(FakeChainProvider(), FakePriceProvider())
        positions = adapter.collect_positions("wallet")

        self.assertEqual(1, len(positions))
        self.assertEqual("marinade", positions[0].protocol)
        self.assertEqual(270.0, positions[0].usd_value)


if __name__ == "__main__":
    unittest.main()
