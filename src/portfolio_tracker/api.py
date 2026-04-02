from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .db import db_session, list_allocation, list_current_positions, list_latest_prices, list_portfolio_history, summarize_scope


class PortfolioApiHandler(BaseHTTPRequestHandler):
    db_path: Path

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _bad_request(self, message: str) -> None:
        self._send_json({"error": message}, status=HTTPStatus.BAD_REQUEST)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path == "/health":
            self._send_json({"status": "ok"})
            return

        if parsed.path == "/v1/summary":
            scope = _validate_scope(query.get("scope", ["combined"])[0])
            if scope is None:
                self._bad_request("scope must be wallet_1, wallet_2, wallet_3, or combined")
                return
            with db_session(self.db_path) as conn:
                summary = summarize_scope(conn, scope)
            self._send_json(
                {
                    "scope": summary.scope,
                    "total_usd": summary.total_usd,
                    "snapshot_ts": summary.snapshot_ts,
                    "pnl_24h": summary.pnl_24h,
                    "pnl_7d": summary.pnl_7d,
                }
            )
            return

        if parsed.path == "/v1/positions":
            scope = _validate_scope(query.get("scope", ["combined"])[0])
            if scope is None:
                self._bad_request("scope must be wallet_1, wallet_2, wallet_3, or combined")
                return
            with db_session(self.db_path) as conn:
                positions = list_current_positions(conn, scope)
            self._send_json({"scope": scope, "count": len(positions), "positions": positions})
            return



        if parsed.path == "/v1/allocation":
            scope = _validate_scope(query.get("scope", ["combined"])[0])
            if scope is None:
                self._bad_request("scope must be wallet_1, wallet_2, wallet_3, or combined")
                return
            by = query.get("by", ["protocol"])[0]
            if by not in {"protocol", "wallet"}:
                self._bad_request("by must be protocol or wallet")
                return
            with db_session(self.db_path) as conn:
                allocation = list_allocation(conn, scope, by=by)
            self._send_json({"scope": scope, "by": by, "count": len(allocation), "allocation": allocation})
            return

        if parsed.path == "/v1/prices":
            limit_str = query.get("limit", ["200"])[0]
            try:
                limit = max(1, min(1000, int(limit_str)))
            except ValueError:
                self._bad_request("limit must be an integer")
                return
            with db_session(self.db_path) as conn:
                prices = list_latest_prices(conn, limit)
            self._send_json({"count": len(prices), "prices": prices})
            return

        if parsed.path == "/v1/history":
            scope = _validate_scope(query.get("scope", ["combined"])[0])
            if scope is None:
                self._bad_request("scope must be wallet_1, wallet_2, wallet_3, or combined")
                return
            limit_str = query.get("limit", ["100"])[0]
            try:
                limit = max(1, min(1000, int(limit_str)))
            except ValueError:
                self._bad_request("limit must be an integer")
                return
            with db_session(self.db_path) as conn:
                history = list_portfolio_history(conn, scope, limit)
            self._send_json({"scope": scope, "count": len(history), "history": history})
            return

        self._send_json({"error": "not found"}, status=HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args) -> None:
        return


def _validate_scope(scope: str) -> str | None:
    if scope in {"wallet_1", "wallet_2", "wallet_3", "combined"}:
        return scope
    return None


def serve_api(db_path: Path, host: str = "127.0.0.1", port: int = 8080) -> None:
    class Handler(PortfolioApiHandler):
        pass

    Handler.db_path = db_path
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Serving API on http://{host}:{port} using db={db_path}")
    server.serve_forever()
