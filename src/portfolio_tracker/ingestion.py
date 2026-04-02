from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .adapters.lp_tokens import LpTokenAdapter
from .adapters.marinade import MarinadeAdapter
from .adapters.wallet_tokens import WalletTokenAdapter
from .config import TRACKED_WALLETS
from .db import (
    finish_ingestion_run,
    insert_position_snapshot,
    save_portfolio_snapshot,
    start_ingestion_run,
    summarize_scope,
    upsert_current_position,
    upsert_price,
)
from .models import utc_now_iso
from .providers import (
    CoinGeckoPriceProvider,
    FallbackPriceProvider,
    PriceProvider,
    SolanaRpcProvider,
    StaticPriceProvider,
    default_rpc_url,
)


@dataclass(slots=True)
class IngestionResult:
    positions_written: int
    errors: int
    error_messages: list[str]


def run_ingestion(conn, db_path: Path, rpc_url: str | None = None, price_provider: PriceProvider | None = None) -> IngestionResult:
    del db_path  # reserved for future use (cache files, etc.)

    chain_provider = SolanaRpcProvider(rpc_url or default_rpc_url())
    prices = price_provider or FallbackPriceProvider([CoinGeckoPriceProvider(), StaticPriceProvider()])
    adapters = [
        WalletTokenAdapter(chain_provider, prices),
        MarinadeAdapter(chain_provider, prices),
        LpTokenAdapter(chain_provider, prices),
    ]

    run_id = start_ingestion_run(conn)
    snapshot_ts = utc_now_iso()

    positions_written = 0
    errors = 0
    error_messages: list[str] = []

    for wallet in TRACKED_WALLETS:
        for adapter in adapters:
            try:
                positions = adapter.collect_positions(wallet.address)
                for position in positions:
                    upsert_current_position(conn, position)
                    insert_position_snapshot(conn, position, snapshot_ts)
                    for quantity in position.quantity:
                        price = prices.get_price_usd(quantity.mint)
                        if price is not None:
                            upsert_price(conn, quantity.mint, float(price), source="provider_chain", confidence=None)
                    positions_written += 1
            except Exception as exc:
                errors += 1
                error_messages.append(f"wallet={wallet.label} adapter={adapter.protocol_name} error={exc}")

    for scope in ["wallet_1", "wallet_2", "wallet_3", "combined"]:
        summary = summarize_scope(conn, scope)
        summary.snapshot_ts = snapshot_ts
        save_portfolio_snapshot(conn, summary)

    status = "success" if errors == 0 else "partial_success"
    notes = f"positions_written={positions_written}; errors={errors}; details={' | '.join(error_messages)}"
    finish_ingestion_run(conn, run_id, status=status, error_count=errors, notes=notes)

    return IngestionResult(positions_written=positions_written, errors=errors, error_messages=error_messages)
