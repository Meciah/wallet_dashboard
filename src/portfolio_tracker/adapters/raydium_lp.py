from __future__ import annotations

from decimal import Decimal

from portfolio_tracker.adapters.base import ProtocolAdapter
from portfolio_tracker.config import RAYDIUM_LP_MINTS
from portfolio_tracker.models import Position, QuantityComponent
from portfolio_tracker.providers import ChainDataProvider, PriceProvider


class RaydiumLpAdapter(ProtocolAdapter):
    protocol_name = "raydium"

    def __init__(self, chain_provider: ChainDataProvider, price_provider: PriceProvider):
        self.chain_provider = chain_provider
        self.price_provider = price_provider

    def collect_positions(self, wallet_address: str) -> list[Position]:
        balances = self.chain_provider.get_token_balances(wallet_address)
        positions: list[Position] = []

        for balance in balances:
            lp_name = RAYDIUM_LP_MINTS.get(balance.mint)
            if lp_name is None:
                continue

            price = self.price_provider.get_price_usd(balance.mint) or Decimal("0")
            positions.append(
                Position(
                    wallet_address=wallet_address,
                    protocol=self.protocol_name,
                    position_type="lp",
                    position_key=f"{wallet_address}:raydium:{balance.mint}",
                    quantity=[
                        QuantityComponent(
                            mint=balance.mint,
                            symbol=lp_name,
                            amount=float(balance.amount),
                        )
                    ],
                    usd_value=float(balance.amount * price),
                    raw={
                        "mint": balance.mint,
                        "lp_name": lp_name,
                        "amount": str(balance.amount),
                        "source": "raydium_mint_allowlist",
                    },
                )
            )

        return positions
