// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applySchema,
  connect,
  finishIngestionRun,
  insertPositionSnapshot,
  listAllocation,
  listCurrentPositions,
  listIngestionRuns,
  listLatestPrices,
  listPortfolioHistory,
  savePortfolioSnapshotSeries,
  savePortfolioSnapshot,
  seedWalletsAndProtocols,
  startIngestionRun,
  summarizeHistoryScope,
  summarizeScope,
  upsertCurrentPosition,
  upsertPrice,
} from "../src/backend/db.js";
import { HISTORY_SERIES, PUMP_MINT, SOL_MINT, URMOM_MINT } from "../src/backend/config.js";

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
    quantity: [{ mint: PUMP_MINT, symbol: "PUMP", amount: 1 }],
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
        quantity: [{ mint: SOL_MINT, symbol: "SOL", amount: 2 }],
        usd_value: 75,
      }),
    );
    upsertCurrentPosition(
      db,
      makePosition({
        wallet_address: "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
        protocol: "raydium",
        position_type: "lp",
        position_key: "position-3",
        quantity: [{ mint: URMOM_MINT, symbol: "URMOM", amount: 3 }],
        usd_value: 25,
      }),
    );

    const summary = summarizeScope(db, "wallet_1");
    savePortfolioSnapshot(db, summary);
    const coreSummary = summarizeHistoryScope(db, "combined");
    coreSummary.snapshot_ts = "2026-04-28T18:45:48.266Z";
    savePortfolioSnapshotSeries(db, coreSummary, HISTORY_SERIES.CORE);
    upsertPrice(db, PUMP_MINT, 1, "seed");
    upsertPrice(db, PUMP_MINT, 2, "seed");
    upsertPrice(db, SOL_MINT, 5, "seed");

    const runId = startIngestionRun(db);
    finishIngestionRun(db, runId, "success", 0, "ok");

    const positions = listCurrentPositions(db, "wallet_1");
    const allocation = listAllocation(db, "combined", "protocol");
    const prices = listLatestPrices(db);
    const history = listPortfolioHistory(db, "wallet_1", 5, HISTORY_SERIES.WITH_LIQUIDITY);
    const coreHistory = listPortfolioHistory(db, "combined", 5, HISTORY_SERIES.CORE);
    const runs = listIngestionRuns(db, 5);

    expect(positions).toHaveLength(1);
    expect(positions[0].wallet_label).toBe("3dhj...VK7R");
    expect(history[0].total_usd).toBe(123);
    expect(coreHistory[0].total_usd).toBe(198);
    expect(allocation[0]).toEqual({
      protocol: "holdings",
      protocol_label: "Holdings",
      protocols: ["wallet_tokens"],
      total_usd: 123,
    });
    expect(prices.find((item) => item.mint === PUMP_MINT)?.price_usd).toBe(2);
    expect(runs[0].status).toBe("success");

    db.close();
  });

  it("excludes ignored scam tokens from positions, summaries, allocations, and history", () => {
    const { dir, db } = createTempDb();
    cleanupPaths.push(dir);
    const snapshotTs = "2026-04-29T12:00:00.000Z";
    const goodPosition = makePosition({
      quantity: [{ mint: PUMP_MINT, symbol: "PUMP", name: "Pump", amount: 1 }],
      usd_value: 123,
    });
    const scamPosition = makePosition({
      position_key: "scam-position",
      quantity: [{ mint: "scam-mint", symbol: "JUPHUB", name: "JupiterHub.io", amount: 528135 }],
      usd_value: 9142.02,
      raw: {
        mint: "scam-mint",
        display_name: "JupiterHub.io",
        display_symbol: "JUPHUB",
      },
    });

    upsertCurrentPosition(db, goodPosition);
    upsertCurrentPosition(db, scamPosition);
    insertPositionSnapshot(db, goodPosition, snapshotTs);
    insertPositionSnapshot(db, scamPosition, snapshotTs);
    savePortfolioSnapshotSeries(
      db,
      {
        scope: "wallet_1",
        snapshot_ts: snapshotTs,
        total_usd: goodPosition.usd_value + scamPosition.usd_value,
        pnl_24h: null,
        pnl_7d: null,
      },
      HISTORY_SERIES.WITH_LIQUIDITY,
    );

    expect(listCurrentPositions(db, "wallet_1")).toHaveLength(1);
    expect(summarizeScope(db, "wallet_1").total_usd).toBe(123);
    expect(listAllocation(db, "wallet_1", "protocol")[0].total_usd).toBe(123);
    expect(listPortfolioHistory(db, "wallet_1", 5, HISTORY_SERIES.WITH_LIQUIDITY)[0].total_usd).toBe(123);

    db.close();
  });
});
