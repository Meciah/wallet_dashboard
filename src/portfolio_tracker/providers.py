from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Protocol

from .config import COINGECKO_IDS_BY_MINT

LAMPORTS_PER_SOL = Decimal("1000000000")


@dataclass(frozen=True)
class TokenBalance:
    mint: str
    amount: Decimal
    decimals: int
    symbol: str | None = None


class ChainDataProvider(Protocol):
    def get_sol_balance(self, wallet_address: str) -> Decimal:
        ...

    def get_token_balances(self, wallet_address: str) -> list[TokenBalance]:
        ...

    def get_parsed_multiple_accounts(self, addresses: list[str]) -> list[dict[str, Any]]:
        ...


class PriceProvider(Protocol):
    def get_price_usd(self, mint: str) -> Decimal | None:
        ...


class SolanaRpcProvider:
    def __init__(self, rpc_url: str):
        self.rpc_url = rpc_url

    def _rpc(self, method: str, params: list[object]) -> dict:
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        request = urllib.request.Request(
            self.rpc_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.loads(response.read())
        if "error" in body:
            raise RuntimeError(f"RPC {method} failed: {body['error']}")
        return body["result"]

    def get_sol_balance(self, wallet_address: str) -> Decimal:
        result = self._rpc("getBalance", [wallet_address, {"commitment": "confirmed"}])
        lamports = Decimal(str(result["value"]))
        return lamports / LAMPORTS_PER_SOL

    def get_token_balances(self, wallet_address: str) -> list[TokenBalance]:
        result = self._rpc(
            "getTokenAccountsByOwner",
            [
                wallet_address,
                {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
                {"encoding": "jsonParsed", "commitment": "confirmed"},
            ],
        )

        balances: list[TokenBalance] = []
        for account in result.get("value", []):
            parsed = account.get("account", {}).get("data", {}).get("parsed", {})
            info = parsed.get("info", {})
            token_amount = info.get("tokenAmount", {})
            amount_ui = token_amount.get("uiAmountString")
            mint = info.get("mint")
            if amount_ui is None or mint is None:
                continue
            amount = Decimal(amount_ui)
            if amount == 0:
                continue
            decimals = int(token_amount.get("decimals", 0))
            balances.append(TokenBalance(mint=mint, amount=amount, decimals=decimals))
        return balances

    def get_parsed_multiple_accounts(self, addresses: list[str]) -> list[dict[str, Any]]:
        if not addresses:
            return []
        result = self._rpc(
            "getMultipleAccounts",
            [addresses, {"encoding": "jsonParsed", "commitment": "confirmed"}],
        )
        values = result.get("value", [])
        accounts: list[dict[str, Any]] = []
        for address, account in zip(addresses, values):
            if account is None:
                continue
            accounts.append({"address": address, "account": account})
        return accounts


class StaticPriceProvider:
    """Fallback-only prices to keep ingestion deterministic without API keys."""

    DEFAULTS: dict[str, Decimal] = {
        "So11111111111111111111111111111111111111112": Decimal("0"),
        "mSoLzYCxHdYgdzUevW6Y8k9sW5M2YfLQ7fPjYq4Jp7": Decimal("0"),
    }

    def __init__(self, overrides: dict[str, Decimal] | None = None):
        self._prices = dict(self.DEFAULTS)
        if overrides:
            self._prices.update(overrides)

    def get_price_usd(self, mint: str) -> Decimal | None:
        return self._prices.get(mint)


class CoinGeckoPriceProvider:
    """Fetches prices using CoinGecko simple price API and mint->id mapping."""

    api_url = "https://api.coingecko.com/api/v3/simple/price"

    def __init__(self):
        self._cache: dict[str, Decimal] = {}

    def get_price_usd(self, mint: str) -> Decimal | None:
        if mint in self._cache:
            return self._cache[mint]

        coin_id = COINGECKO_IDS_BY_MINT.get(mint)
        if coin_id is None:
            return None

        params = urllib.parse.urlencode({"ids": coin_id, "vs_currencies": "usd"})
        url = f"{self.api_url}?{params}"
        with urllib.request.urlopen(url, timeout=15) as response:
            body = json.loads(response.read())

        usd = body.get(coin_id, {}).get("usd")
        if usd is None:
            return None

        price = Decimal(str(usd))
        self._cache[mint] = price
        return price


class FallbackPriceProvider:
    def __init__(self, providers: list[PriceProvider]):
        self.providers = providers

    def get_price_usd(self, mint: str) -> Decimal | None:
        for provider in self.providers:
            try:
                price = provider.get_price_usd(mint)
            except Exception:
                continue
            if price is not None:
                return price
        return None


def default_rpc_url() -> str:
    return os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com")
