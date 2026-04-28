// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PUMP_MINT } from "../src/backend/config.js";
import { applySchema, connect, listLatestPrices, seedWalletsAndProtocols } from "../src/backend/db.js";
import { syncTrackedTokenPrices } from "../src/backend/ingestion.js";

const cleanupPaths = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop(), { recursive: true, force: true });
  }
});

describe("ingestion watched token prices", () => {
  it("stores a tracked PUMP quote even without wallet exposure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wallet-dashboard-ingestion-"));
    cleanupPaths.push(dir);

    const db = connect(join(dir, "portfolio.db"));
    applySchema(db);
    seedWalletsAndProtocols(db);

    await syncTrackedTokenPrices(db, {
      async getQuote(mint) {
        if (mint === PUMP_MINT) {
          return { mint, priceUsd: 0.00184 };
        }
        return null;
      },
    });

    const pumpPrice = listLatestPrices(db).find((item) => item.mint === PUMP_MINT);
    expect(pumpPrice).toMatchObject({
      mint: PUMP_MINT,
      symbol: "PUMP",
      name: "Pump",
      price_usd: 0.00184,
      source: "provider_chain",
    });

    db.close();
  });
});
