import { createServer } from "node:http";

import {
  listAllocation,
  listCurrentPositions,
  listIngestionRuns,
  listLatestPrices,
  listPortfolioHistory,
  summarizeScope,
  withDb,
} from "./db.js";
import { validateScope } from "./utils.js";

function sendJson(response, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": body.byteLength,
  });
  response.end(body);
}

function readLimit(url, fallback, max) {
  const value = url.searchParams.get("limit");
  if (value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error("limit must be an integer");
  }

  return Math.max(1, Math.min(max, parsed));
}

export function serveApi(dbPath, { host = "127.0.0.1", port = 8080 } = {}) {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

    try {
      if (url.pathname === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (url.pathname === "/v1/summary") {
        const scope = validateScope(url.searchParams.get("scope") ?? "combined");
        if (!scope) {
          sendJson(response, 400, { error: "scope must be wallet_1, wallet_2, wallet_3, or combined" });
          return;
        }

        const payload = withDb(dbPath, (db) => summarizeScope(db, scope));
        sendJson(response, 200, payload);
        return;
      }

      if (url.pathname === "/v1/positions") {
        const scope = validateScope(url.searchParams.get("scope") ?? "combined");
        if (!scope) {
          sendJson(response, 400, { error: "scope must be wallet_1, wallet_2, wallet_3, or combined" });
          return;
        }

        const positions = withDb(dbPath, (db) => listCurrentPositions(db, scope));
        sendJson(response, 200, { scope, count: positions.length, positions });
        return;
      }

      if (url.pathname === "/v1/ingestion-runs") {
        const limit = readLimit(url, 50, 500);
        const runs = withDb(dbPath, (db) => listIngestionRuns(db, limit));
        sendJson(response, 200, { count: runs.length, runs });
        return;
      }

      if (url.pathname === "/v1/allocation") {
        const scope = validateScope(url.searchParams.get("scope") ?? "combined");
        if (!scope) {
          sendJson(response, 400, { error: "scope must be wallet_1, wallet_2, wallet_3, or combined" });
          return;
        }

        const by = url.searchParams.get("by") ?? "protocol";
        if (!["protocol", "wallet"].includes(by)) {
          sendJson(response, 400, { error: "by must be protocol or wallet" });
          return;
        }

        const allocation = withDb(dbPath, (db) => listAllocation(db, scope, by));
        sendJson(response, 200, { scope, by, count: allocation.length, allocation });
        return;
      }

      if (url.pathname === "/v1/prices") {
        const limit = readLimit(url, 200, 1000);
        const prices = withDb(dbPath, (db) => listLatestPrices(db, limit));
        sendJson(response, 200, { count: prices.length, prices });
        return;
      }

      if (url.pathname === "/v1/history") {
        const scope = validateScope(url.searchParams.get("scope") ?? "combined");
        if (!scope) {
          sendJson(response, 400, { error: "scope must be wallet_1, wallet_2, wallet_3, or combined" });
          return;
        }

        const limit = readLimit(url, 100, 1000);
        const history = withDb(dbPath, (db) => listPortfolioHistory(db, scope, limit));
        sendJson(response, 200, { scope, count: history.length, history });
        return;
      }

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });

  server.listen(port, host, () => {
    process.stdout.write(`Serving API on http://${host}:${port} using db=${dbPath}\n`);
  });

  return server;
}
