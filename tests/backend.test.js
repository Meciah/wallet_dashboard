// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applySchema,
  connect,
  finishIngestionRun,
  listAllocation,
  listCurrentPositions,
  listIngestionRuns,
  listLatestPrices,
  listPortfolioHistory,
  savePortfolioSnapshot,
  seedWalletsAndProtocols,
  startIngestionRun,
  summarizeScope,
  upsertCurrentPosition,
  upsertPrice,
} from "../src/backend/db.js";

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "wallet-dashboard-"));
  const dbPath = join(dir, "portfolio.db");
  const db = connect(dbPath);
  applySchema(db);
  seedWalletsAndProtocols(db);
  return { dir, dbPath, db };
}

function makePosition(overrides = {}) {
  return {
    wallet_address: "3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R",
    protocol: "wallet_tokens",
    position_type: "wallet_balance",
    position_key: "position-1",
    quantity: [{ mint: "mint-1", symbol: "M1", amount: 1 }],
    usd_value: 123,
    raw: { source: "test" },
    updated_at: "2026-04-02T18:45:48.266Z",
    ...overrides,
  };
}

const cleanupPaths = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop(), { recursive: true, force: true });
  }
});

describe("backend db queries", () => {
  it("stores positions, summaries, allocations, prices, and ingestion runs", () => {
    const { dir, db } = createTempDb();
    cleanupPaths.push(dir);

    upsertCurrentPosition(db, makePosition());
    upsertCurrentPosition(
      db,
      makePosition({
        wallet_address: "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
        protocol: "marinade",
        position_type: "staking",
        position_key: "position-2",
        quantity: [{ mint: "mint-2", symbol: "M2", amount: 2 }],
        usd_value: 75,
      }),
    );

    const summary = summarizeScope(db, "wallet_1");
    savePortfolioSnapshot(db, summary);
    upsertPrice(db, "mint-1", 1, "seed");
    upsertPrice(db, "mint-1", 2, "seed");
    upsertPrice(db, "mint-2", 5, "seed");

    const runId = startIngestionRun(db);
    finishIngestionRun(db, runId, "success", 0, "ok");

    const positions = listCurrentPositions(db, "wallet_1");
    const allocation = listAllocation(db, "combined", "protocol");
    const prices = listLatestPrices(db);
    const history = listPortfolioHistory(db, "wallet_1", 5);
    const runs = listIngestionRuns(db, 5);

    expect(positions).toHaveLength(1);
    expect(positions[0].wallet_label).toBe("wallet_1");
    expect(history[0].total_usd).toBe(123);
    expect(allocation[0]).toEqual({ protocol: "wallet_tokens", total_usd: 123 });
    expect(prices.find((item) => item.mint === "mint-1")?.price_usd).toBe(2);
    expect(runs[0].status).toBe("success");

    db.close();
  });
});
