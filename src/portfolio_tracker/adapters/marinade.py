from __future__ import annotations

from decimal import Decimal

from portfolio_tracker.adapters.base import ProtocolAdapter
from portfolio_tracker.config import MSOL_MINT, TOKEN_SYMBOL_OVERRIDES
from portfolio_tracker.models import Position, QuantityComponent
from portfolio_tracker.providers import ChainDataProvider, PriceProvider


class MarinadeAdapter(ProtocolAdapter):
    protocol_name = "marinade"

    def __init__(self, chain_provider: ChainDataProvider, price_provider: PriceProvider):
        self.chain_provider = chain_provider
        self.price_provider = price_provider

    def collect_positions(self, wallet_address: str) -> list[Position]:
        token_balances = self.chain_provider.get_token_balances(wallet_address)
        msol_balance = next((balance for balance in token_balances if balance.mint == MSOL_MINT), None)
        if msol_balance is None:
            return []

        price = self.price_provider.get_price_usd(MSOL_MINT) or Decimal("0")
        amount = msol_balance.amount
        return [
            Position(
                wallet_address=wallet_address,
                protocol=self.protocol_name,
                position_type="staking",
                position_key=f"{wallet_address}:marinade:{MSOL_MINT}",
                quantity=[
                    QuantityComponent(
                        mint=MSOL_MINT,
                        symbol=TOKEN_SYMBOL_OVERRIDES.get(MSOL_MINT, "mSOL"),
                        amount=float(amount),
                    )
                ],
                usd_value=float(amount * price),
                raw={
                    "note": "Derived from wallet mSOL balance; extend with Marinade stake-account parsing",
                    "amount": str(amount),
                },
            )
        ]
