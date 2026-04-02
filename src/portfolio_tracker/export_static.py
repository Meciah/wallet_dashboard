from __future__ import annotations

import json
from pathlib import Path

from .db import (
    db_session,
    list_allocation,
    list_current_positions,
    list_ingestion_runs,
    list_latest_prices,
    list_portfolio_history,
    summarize_scope,
)

SCOPES = ("wallet_1", "wallet_2", "wallet_3", "combined")


def export_static_json(db_path: Path, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    with db_session(db_path) as conn:
        payload = {
            "generated": {},
            "summary": {},
            "positions": {},
            "allocation_protocol": {},
            "allocation_wallet": {},
            "history": {},
            "prices": list_latest_prices(conn, limit=500),
            "ingestion_runs": list_ingestion_runs(conn, limit=100),
        }

        for scope in SCOPES:
            summary = summarize_scope(conn, scope)
            payload["summary"][scope] = {
                "scope": summary.scope,
                "total_usd": summary.total_usd,
                "snapshot_ts": summary.snapshot_ts,
                "pnl_24h": summary.pnl_24h,
                "pnl_7d": summary.pnl_7d,
            }
            payload["positions"][scope] = list_current_positions(conn, scope)
            payload["allocation_protocol"][scope] = list_allocation(conn, scope, by="protocol")
            payload["allocation_wallet"][scope] = list_allocation(conn, scope, by="wallet")
            payload["history"][scope] = list_portfolio_history(conn, scope, limit=300)

    (out_dir / "portfolio-data.json").write_text(json.dumps(payload, indent=2))
