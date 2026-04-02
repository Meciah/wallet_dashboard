from __future__ import annotations

from decimal import Decimal

from portfolio_tracker.adapters.base import ProtocolAdapter
from portfolio_tracker.config import SOL_MINT, TOKEN_SYMBOL_OVERRIDES
from portfolio_tracker.models import Position, QuantityComponent
from portfolio_tracker.providers import ChainDataProvider, PriceProvider


class WalletTokenAdapter(ProtocolAdapter):
    protocol_name = "wallet_tokens"

    def __init__(self, chain_provider: ChainDataProvider, price_provider: PriceProvider):
        self.chain_provider = chain_provider
        self.price_provider = price_provider

    def collect_positions(self, wallet_address: str) -> list[Position]:
        positions: list[Position] = []

        sol_amount = self.chain_provider.get_sol_balance(wallet_address)
        sol_price = self.price_provider.get_price_usd(SOL_MINT) or Decimal("0")
        positions.append(
            Position(
                wallet_address=wallet_address,
                protocol=self.protocol_name,
                position_type="wallet_balance",
                position_key=f"{wallet_address}:native:{SOL_MINT}",
                quantity=[
                    QuantityComponent(
                        mint=SOL_MINT,
                        symbol=TOKEN_SYMBOL_OVERRIDES.get(SOL_MINT, "SOL"),
                        amount=float(sol_amount),
                    )
                ],
                usd_value=float(sol_amount * sol_price),
                raw={"amount": str(sol_amount), "mint": SOL_MINT},
            )
        )

        for token in self.chain_provider.get_token_balances(wallet_address):
            symbol = token.symbol or TOKEN_SYMBOL_OVERRIDES.get(token.mint, token.mint[:4])
            price = self.price_provider.get_price_usd(token.mint) or Decimal("0")
            positions.append(
                Position(
                    wallet_address=wallet_address,
                    protocol=self.protocol_name,
                    position_type="wallet_balance",
                    position_key=f"{wallet_address}:token:{token.mint}",
                    quantity=[
                        QuantityComponent(
                            mint=token.mint,
                            symbol=symbol,
                            amount=float(token.amount),
                        )
                    ],
                    usd_value=float(token.amount * price),
                    raw={"amount": str(token.amount), "mint": token.mint, "decimals": token.decimals},
                )
            )

        return positions
