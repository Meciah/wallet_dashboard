from __future__ import annotations

from decimal import Decimal

from portfolio_tracker.adapters.base import ProtocolAdapter
from portfolio_tracker.config import KNOWN_LP_MINTS
from portfolio_tracker.models import Position, QuantityComponent
from portfolio_tracker.providers import ChainDataProvider, PriceProvider


class LpTokenAdapter(ProtocolAdapter):
    """Detects LP token holdings by mint allowlist and normalizes them as LP positions."""

    protocol_name = "lp_tokens"

    def __init__(self, chain_provider: ChainDataProvider, price_provider: PriceProvider):
        self.chain_provider = chain_provider
        self.price_provider = price_provider

    def collect_positions(self, wallet_address: str) -> list[Position]:
        positions: list[Position] = []
        balances = self.chain_provider.get_token_balances(wallet_address)

        for balance in balances:
            lp_name = KNOWN_LP_MINTS.get(balance.mint)
            if lp_name is None:
                continue

            price = self.price_provider.get_price_usd(balance.mint) or Decimal("0")
            positions.append(
                Position(
                    wallet_address=wallet_address,
                    protocol=self.protocol_name,
                    position_type="lp",
                    position_key=f"{wallet_address}:lp:{balance.mint}",
                    quantity=[
                        QuantityComponent(
                            mint=balance.mint,
                            symbol=lp_name,
                            amount=float(balance.amount),
                        )
                    ],
                    usd_value=float(balance.amount * price),
                    raw={
                        "lp_name": lp_name,
                        "mint": balance.mint,
                        "amount": str(balance.amount),
                        "note": "LP token detected from configured mint allowlist",
                    },
                )
            )

        return positions
