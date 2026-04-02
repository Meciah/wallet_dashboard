from __future__ import annotations

import unittest
from decimal import Decimal

from portfolio_tracker.adapters.marinade_native import MarinadeNativeStakeAdapter
from portfolio_tracker.adapters.raydium_lp import RaydiumLpAdapter
from portfolio_tracker.config import RAYDIUM_LP_MINTS, SOL_MINT
from portfolio_tracker.providers import TokenBalance


class FakeChainProvider:
    def get_sol_balance(self, wallet_address: str) -> Decimal:
        return Decimal("0")

    def get_token_balances(self, wallet_address: str) -> list[TokenBalance]:
        ray_mint = next(iter(RAYDIUM_LP_MINTS))
        return [TokenBalance(mint=ray_mint, amount=Decimal("2"), decimals=6)]

    def get_parsed_multiple_accounts(self, addresses: list[str]):
        return [
            {
                "address": addresses[0],
                "account": {
                    "data": {
                        "parsed": {
                            "info": {
                                "stake": {
                                    "delegation": {
                                        "stake": "1500000000",
                                        "voter": "",
                                    }
                                }
                            }
                        }
                    }
                },
            }
        ]


class FakePriceProvider:
    def get_price_usd(self, mint: str):
        ray_mint = next(iter(RAYDIUM_LP_MINTS))
        prices = {
            ray_mint: Decimal("10"),
            SOL_MINT: Decimal("100"),
        }
        return prices.get(mint)


class RaydiumAndMarinadeNativeTests(unittest.TestCase):
    def test_raydium_lp_adapter(self) -> None:
        adapter = RaydiumLpAdapter(FakeChainProvider(), FakePriceProvider())
        positions = adapter.collect_positions("wallet")
        self.assertEqual(1, len(positions))
        self.assertEqual("raydium", positions[0].protocol)
        self.assertEqual(20.0, positions[0].usd_value)

    def test_marinade_native_adapter(self) -> None:
        from portfolio_tracker import config

        wallet = "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS"
        original = config.MARINADE_NATIVE_STAKE_ACCOUNTS[wallet]
        config.MARINADE_NATIVE_STAKE_ACCOUNTS[wallet] = ["stakeAcct1"]
        try:
            adapter = MarinadeNativeStakeAdapter(FakeChainProvider(), FakePriceProvider())
            positions = adapter.collect_positions(wallet)
            self.assertEqual(1, len(positions))
            self.assertEqual("marinade_native", positions[0].protocol)
            self.assertEqual(150.0, positions[0].usd_value)
        finally:
            config.MARINADE_NATIVE_STAKE_ACCOUNTS[wallet] = original


if __name__ == "__main__":
    unittest.main()
