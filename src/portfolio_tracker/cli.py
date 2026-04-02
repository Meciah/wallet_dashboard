from __future__ import annotations

import argparse
from pathlib import Path

from .api import serve_api
from .config import DB_PATH
from .db import apply_schema, db_session, seed_wallets_and_protocols, summarize_scope
from .ingestion import run_ingestion
from .providers import default_rpc_url


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="SQLite-first wallet portfolio tracker")
    parser.add_argument("--db", type=Path, default=DB_PATH, help="Path to sqlite database file")

    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="Initialize schema and seed static data")

    ingest_parser = sub.add_parser("ingest", help="Run one ingestion cycle")
    ingest_parser.add_argument("--rpc-url", default=default_rpc_url(), help="Solana RPC endpoint URL")

    summary_parser = sub.add_parser("summary", help="Print current summary for one scope")
    summary_parser.add_argument(
        "--scope",
        choices=["wallet_1", "wallet_2", "wallet_3", "combined"],
        default="combined",
    )

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


def command_summary(db_path: Path, scope: str) -> None:
    with db_session(db_path) as conn:
        summary = summarize_scope(conn, scope)
    print(f"scope={summary.scope} total_usd={summary.total_usd:.2f}")


def main() -> None:
    parser = make_parser()
    args = parser.parse_args()

    if args.command == "init-db":
        command_init_db(args.db)
        return

    if args.command == "ingest":
        command_ingest(args.db, args.rpc_url)
        return

    if args.command == "summary":
        command_summary(args.db, args.scope)
        return

    if args.command == "serve-api":
        serve_api(args.db, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
