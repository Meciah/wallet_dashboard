from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class WalletConfig:
    label: str
    address: str


TRACKED_WALLETS: tuple[WalletConfig, ...] = (
    WalletConfig("wallet_1", "3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R"),
    WalletConfig("wallet_2", "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS"),
    WalletConfig("wallet_3", "CRsHntQirTYe9zwZYYMJpt6Wm6TaZyncUYF4TgW39zcf"),
)

DB_PATH = Path("portfolio.db")

SOL_MINT = "So11111111111111111111111111111111111111112"
MSOL_MINT = "mSoLzYCxHdYgdzUevW6Y8k9sW5M2YfLQ7fPjYq4Jp7"

TOKEN_SYMBOL_OVERRIDES: dict[str, str] = {
    SOL_MINT: "SOL",
    MSOL_MINT: "mSOL",
}

# Configure LP token mints you want tracked as LP positions.
# Add additional mints as your wallets use more pools.
KNOWN_LP_MINTS: dict[str, str] = {
    "LPPlaceholderMint11111111111111111111111111111111": "LP_PLACEHOLDER",
}


COINGECKO_IDS_BY_MINT: dict[str, str] = {
    SOL_MINT: "solana",
    MSOL_MINT: "msol",
}
