from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .config import TRACKED_WALLETS
from .models import PortfolioSummary, Position, utc_now_iso


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


@contextmanager
def db_session(db_path: Path) -> Iterator[sqlite3.Connection]:
    conn = connect(db_path)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def apply_schema(conn: sqlite3.Connection, schema_path: Path) -> None:
    conn.executescript(schema_path.read_text())


def seed_wallets_and_protocols(conn: sqlite3.Connection) -> None:
    for wallet in TRACKED_WALLETS:
        conn.execute(
            """
            INSERT INTO wallets(label, address)
            VALUES(?, ?)
            ON CONFLICT(address) DO UPDATE SET label = excluded.label
            """,
            (wallet.label, wallet.address),
        )

    default_protocols = (
        ("wallet_tokens", "wallet"),
        ("marinade", "staking"),
        ("lp_tokens", "lp"),
    )
    for name, category in default_protocols:
        conn.execute(
            """
            INSERT INTO protocols(name, category)
            VALUES(?, ?)
            ON CONFLICT(name) DO UPDATE SET category = excluded.category
            """,
            (name, category),
        )


def start_ingestion_run(conn: sqlite3.Connection) -> int:
    started = utc_now_iso()
    cur = conn.execute(
        "INSERT INTO ingestion_runs(started_at, status, error_count) VALUES(?, 'running', 0)",
        (started,),
    )
    return int(cur.lastrowid)


def finish_ingestion_run(conn: sqlite3.Connection, run_id: int, status: str, error_count: int, notes: str = "") -> None:
    conn.execute(
        """
        UPDATE ingestion_runs
        SET ended_at = ?, status = ?, error_count = ?, notes = ?
        WHERE id = ?
        """,
        (utc_now_iso(), status, error_count, notes, run_id),
    )


def upsert_current_position(conn: sqlite3.Connection, position: Position) -> None:
    wallet_id = get_wallet_id(conn, position.wallet_address)
    protocol_id = get_protocol_id(conn, position.protocol)

    conn.execute(
        """
        INSERT INTO positions_current(
            wallet_id, protocol_id, position_type, position_key,
            raw_json, usd_value, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(wallet_id, protocol_id, position_key)
        DO UPDATE SET
            position_type = excluded.position_type,
            raw_json = excluded.raw_json,
            usd_value = excluded.usd_value,
            updated_at = excluded.updated_at
        """,
        (
            wallet_id,
            protocol_id,
            position.position_type,
            position.position_key,
            json.dumps(position.raw),
            position.usd_value,
            position.updated_at,
        ),
    )


def insert_position_snapshot(conn: sqlite3.Connection, position: Position, snapshot_ts: str) -> None:
    wallet_id = get_wallet_id(conn, position.wallet_address)
    protocol_id = get_protocol_id(conn, position.protocol)

    conn.execute(
        """
        INSERT INTO positions_snapshots(
            snapshot_ts, wallet_id, protocol_id, position_key, usd_value,
            quantity_json, rewards_usd, pnl_usd, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            snapshot_ts,
            wallet_id,
            protocol_id,
            position.position_key,
            position.usd_value,
            json.dumps(position.quantity_json()),
            position.rewards_usd,
            position.pnl_usd,
            json.dumps(position.raw),
        ),
    )


def save_portfolio_snapshot(conn: sqlite3.Connection, summary: PortfolioSummary) -> None:
    conn.execute(
        """
        INSERT INTO portfolio_snapshots(snapshot_ts, scope, total_usd, pnl_24h, pnl_7d)
        VALUES(?, ?, ?, ?, ?)
        """,
        (summary.snapshot_ts, summary.scope, summary.total_usd, summary.pnl_24h, summary.pnl_7d),
    )


def get_wallet_id(conn: sqlite3.Connection, wallet_address: str) -> int:
    row = conn.execute("SELECT id FROM wallets WHERE address = ?", (wallet_address,)).fetchone()
    if row is None:
        raise ValueError(f"Wallet not seeded: {wallet_address}")
    return int(row["id"])


def get_protocol_id(conn: sqlite3.Connection, protocol_name: str) -> int:
    row = conn.execute("SELECT id FROM protocols WHERE name = ?", (protocol_name,)).fetchone()
    if row is None:
        raise ValueError(f"Protocol not seeded: {protocol_name}")
    return int(row["id"])


def summarize_scope(conn: sqlite3.Connection, scope: str) -> PortfolioSummary:
    if scope == "combined":
        row = conn.execute("SELECT COALESCE(SUM(usd_value), 0) AS total FROM positions_current").fetchone()
        return PortfolioSummary(scope="combined", total_usd=float(row["total"]))

    row = conn.execute(
        """
        SELECT COALESCE(SUM(pc.usd_value), 0) AS total
        FROM positions_current pc
        JOIN wallets w ON w.id = pc.wallet_id
        WHERE w.label = ?
        """,
        (scope,),
    ).fetchone()
    return PortfolioSummary(scope=scope, total_usd=float(row["total"]))


def list_current_positions(conn: sqlite3.Connection, scope: str) -> list[dict[str, Any]]:
    base_query = """
        SELECT
            w.label AS wallet_label,
            w.address AS wallet_address,
            p.name AS protocol_name,
            p.category AS protocol_category,
            pc.position_type,
            pc.position_key,
            pc.usd_value,
            pc.updated_at,
            pc.raw_json
        FROM positions_current pc
        JOIN wallets w ON w.id = pc.wallet_id
        JOIN protocols p ON p.id = pc.protocol_id
    """

    params: tuple[str, ...] = ()
    if scope != "combined":
        base_query += " WHERE w.label = ?"
        params = (scope,)
    base_query += " ORDER BY pc.usd_value DESC"

    rows = conn.execute(base_query, params).fetchall()
    positions: list[dict[str, Any]] = []
    for row in rows:
        positions.append(
            {
                "wallet_label": row["wallet_label"],
                "wallet_address": row["wallet_address"],
                "protocol": row["protocol_name"],
                "protocol_category": row["protocol_category"],
                "position_type": row["position_type"],
                "position_key": row["position_key"],
                "usd_value": float(row["usd_value"]),
                "updated_at": row["updated_at"],
                "raw": json.loads(row["raw_json"]),
            }
        )
    return positions


def list_portfolio_history(conn: sqlite3.Connection, scope: str, limit: int = 100) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT snapshot_ts, scope, total_usd, pnl_24h, pnl_7d
        FROM portfolio_snapshots
        WHERE scope = ?
        ORDER BY snapshot_ts DESC
        LIMIT ?
        """,
        (scope, limit),
    ).fetchall()

    return [
        {
            "snapshot_ts": row["snapshot_ts"],
            "scope": row["scope"],
            "total_usd": float(row["total_usd"]),
            "pnl_24h": row["pnl_24h"],
            "pnl_7d": row["pnl_7d"],
        }
        for row in rows
    ]


def upsert_price(conn: sqlite3.Connection, mint: str, price_usd: float, source: str, confidence: float | None = None) -> None:
    ts = utc_now_iso()
    conn.execute(
        """
        INSERT INTO prices(mint, asof_ts, price_usd, source, confidence)
        VALUES (?, ?, ?, ?, ?)
        """,
        (mint, ts, price_usd, source, confidence),
    )


def list_latest_prices(conn: sqlite3.Connection, limit: int = 200) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT p1.mint, p1.asof_ts, p1.price_usd, p1.source, p1.confidence
        FROM prices p1
        JOIN (
            SELECT mint, MAX(asof_ts) AS max_ts
            FROM prices
            GROUP BY mint
        ) p2 ON p1.mint = p2.mint AND p1.asof_ts = p2.max_ts
        ORDER BY p1.asof_ts DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [
        {
            "mint": row["mint"],
            "asof_ts": row["asof_ts"],
            "price_usd": float(row["price_usd"]),
            "source": row["source"],
            "confidence": row["confidence"],
        }
        for row in rows
    ]


def list_allocation(conn: sqlite3.Connection, scope: str, by: str = "protocol") -> list[dict[str, Any]]:
    if by not in {"protocol", "wallet"}:
        raise ValueError("by must be protocol or wallet")

    if by == "protocol":
        select_dim = "p.name"
        dim_alias = "protocol"
    else:
        select_dim = "w.label"
        dim_alias = "wallet"

    query = f"""
        SELECT {select_dim} AS dim, COALESCE(SUM(pc.usd_value), 0) AS total_usd
        FROM positions_current pc
        JOIN wallets w ON w.id = pc.wallet_id
        JOIN protocols p ON p.id = pc.protocol_id
    """
    params: tuple[str, ...] = ()
    if scope != "combined":
        query += " WHERE w.label = ?"
        params = (scope,)
    query += " GROUP BY dim ORDER BY total_usd DESC"

    rows = conn.execute(query, params).fetchall()
    return [{dim_alias: row["dim"], "total_usd": float(row["total_usd"])} for row in rows]


def list_ingestion_runs(conn: sqlite3.Connection, limit: int = 50) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, started_at, ended_at, status, error_count, notes
        FROM ingestion_runs
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [
        {
            "id": int(row["id"]),
            "started_at": row["started_at"],
            "ended_at": row["ended_at"],
            "status": row["status"],
            "error_count": int(row["error_count"]),
            "notes": row["notes"],
        }
        for row in rows
    ]
