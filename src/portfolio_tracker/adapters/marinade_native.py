from __future__ import annotations

from decimal import Decimal

from portfolio_tracker.adapters.base import ProtocolAdapter
from portfolio_tracker.config import MARINADE_NATIVE_STAKE_ACCOUNTS, MARINADE_VALIDATOR_VOTE_ACCOUNTS, SOL_MINT
from portfolio_tracker.models import Position, QuantityComponent
from portfolio_tracker.providers import ChainDataProvider, PriceProvider


class MarinadeNativeStakeAdapter(ProtocolAdapter):
    protocol_name = "marinade_native"

    def __init__(self, chain_provider: ChainDataProvider, price_provider: PriceProvider):
        self.chain_provider = chain_provider
        self.price_provider = price_provider

    def collect_positions(self, wallet_address: str) -> list[Position]:
        stake_accounts = MARINADE_NATIVE_STAKE_ACCOUNTS.get(wallet_address, [])
        if not stake_accounts:
            return []

        parsed_accounts = self.chain_provider.get_parsed_multiple_accounts(stake_accounts)
        total_sol = Decimal("0")
        details: list[dict[str, str | float]] = []

        for row in parsed_accounts:
            address = row["address"]
            parsed = row.get("account", {}).get("data", {}).get("parsed", {})
            info = parsed.get("info", {})
            stake_info = info.get("stake", {}).get("delegation", {})
            voter = stake_info.get("voter")
            if MARINADE_VALIDATOR_VOTE_ACCOUNTS and voter not in MARINADE_VALIDATOR_VOTE_ACCOUNTS:
                continue

            active_stake = Decimal(str(stake_info.get("stake", "0")))
            active_sol = active_stake / Decimal("1000000000")
            total_sol += active_sol
            details.append({"stake_account": address, "voter": voter or "", "active_sol": float(active_sol)})

        if total_sol == 0:
            return []

        price = self.price_provider.get_price_usd(SOL_MINT) or Decimal("0")
        return [
            Position(
                wallet_address=wallet_address,
                protocol=self.protocol_name,
                position_type="staking",
                position_key=f"{wallet_address}:marinade_native:aggregate",
                quantity=[QuantityComponent(mint=SOL_MINT, symbol="SOL", amount=float(total_sol))],
                usd_value=float(total_sol * price),
                raw={
                    "native_stake_accounts": details,
                    "note": "Native Marinade stake derived from configured stake accounts",
                },
            )
        ]
