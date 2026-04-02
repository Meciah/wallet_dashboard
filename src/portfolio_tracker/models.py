from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class QuantityComponent:
    mint: str
    symbol: str
    amount: float


@dataclass(slots=True)
class Position:
    wallet_address: str
    protocol: str
    position_type: str
    position_key: str
    quantity: list[QuantityComponent]
    usd_value: float
    rewards_usd: float = 0.0
    pnl_usd: float = 0.0
    raw: dict[str, Any] = field(default_factory=dict)
    updated_at: str = field(default_factory=utc_now_iso)

    def quantity_json(self) -> list[dict[str, Any]]:
        return [asdict(component) for component in self.quantity]


@dataclass(slots=True)
class PortfolioSummary:
    scope: str
    total_usd: float
    snapshot_ts: str = field(default_factory=utc_now_iso)
    pnl_24h: float | None = None
    pnl_7d: float | None = None
