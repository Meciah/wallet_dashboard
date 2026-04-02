from __future__ import annotations

import argparse
import time
from pathlib import Path

from .api import serve_api
from .config import DB_PATH
from .db import apply_schema, db_session, seed_wallets_and_protocols, summarize_scope
from .export_static import export_static_json
from .ingestion import run_ingestion
from .providers import default_rpc_url


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="SQLite-first wallet portfolio tracker")
    parser.add_argument("--db", type=Path, default=DB_PATH, help="Path to sqlite database file")

    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="Initialize schema and seed static data")

    ingest_parser = sub.add_parser("ingest", help="Run one ingestion cycle")
    ingest_parser.add_argument("--rpc-url", default=default_rpc_url(), help="Solana RPC endpoint URL")

    ingest_loop_parser = sub.add_parser("ingest-loop", help="Continuously run ingestion on an interval")
    ingest_loop_parser.add_argument("--rpc-url", default=default_rpc_url(), help="Solana RPC endpoint URL")
    ingest_loop_parser.add_argument("--interval-seconds", type=int, default=300, help="Seconds between ingestion runs")

    summary_parser = sub.add_parser("summary", help="Print current summary for one scope")
    summary_parser.add_argument(
        "--scope",
        choices=["wallet_1", "wallet_2", "wallet_3", "combined"],
        default="combined",
    )

    export_parser = sub.add_parser("export-static", help="Export static JSON for GitHub Pages/mobile UI")
    export_parser.add_argument("--out-dir", type=Path, default=Path("docs/data"))

    serve_parser = sub.add_parser("serve-api", help="Run a local read-only HTTP API server")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8080)
    return parser


def command_init_db(db_path: Path) -> None:
    schema_path = Path(__file__).with_name("schema.sql")
    with db_session(db_path) as conn:
        apply_schema(conn, schema_path)
        seed_wallets_and_protocols(conn)


def command_ingest(db_path: Path, rpc_url: str) -> None:
    with db_session(db_path) as conn:
        result = run_ingestion(conn, db_path, rpc_url=rpc_url)
    print(f"Ingestion complete: positions_written={result.positions_written}, errors={result.errors}")
    if result.error_messages:
        for error in result.error_messages:
            print(f"  - {error}")


def command_ingest_loop(db_path: Path, rpc_url: str, interval_seconds: int) -> None:
    if interval_seconds < 5:
        raise ValueError("interval-seconds must be at least 5")

    run_count = 0
    while True:
        run_count += 1
        print(f"[run {run_count}] starting ingestion")
        command_ingest(db_path, rpc_url)
        print(f"[run {run_count}] sleeping {interval_seconds}s")
        time.sleep(interval_seconds)


def command_summary(db_path: Path, scope: str) -> None:
    with db_session(db_path) as conn:
        summary = summarize_scope(conn, scope)
    print(f"scope={summary.scope} total_usd={summary.total_usd:.2f}")


def command_export_static(db_path: Path, out_dir: Path) -> None:
    export_static_json(db_path, out_dir)
    print(f"Wrote static export to {out_dir / 'portfolio-data.json'}")


def main() -> None:
    parser = make_parser()
    args = parser.parse_args()

    if args.command == "init-db":
        command_init_db(args.db)
        return

    if args.command == "ingest":
        command_ingest(args.db, args.rpc_url)
        return

    if args.command == "ingest-loop":
        command_ingest_loop(args.db, args.rpc_url, args.interval_seconds)
        return

    if args.command == "summary":
        command_summary(args.db, args.scope)
        return

    if args.command == "export-static":
        command_export_static(args.db, args.out_dir)
        return

    if args.command == "serve-api":
        serve_api(args.db, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
