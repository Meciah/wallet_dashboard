// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { serveApi } from "../src/backend/api.js";
import { applySchema, connect, seedWalletsAndProtocols, upsertCurrentPosition } from "../src/backend/db.js";

const cleanupPaths = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop(), { recursive: true, force: true });
  }
});

describe("local api", () => {
  it("serves summary and positions endpoints", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wallet-dashboard-api-"));
    cleanupPaths.push(dir);
    const dbPath = join(dir, "portfolio.db");
    const db = connect(dbPath);
    applySchema(db);
    seedWalletsAndProtocols(db);
    upsertCurrentPosition(db, {
      wallet_address: "3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R",
      protocol: "wallet_tokens",
      position_type: "wallet_balance",
      position_key: "api-position",
      quantity: [{ mint: "mint-1", symbol: "M1", amount: 1 }],
      usd_value: 50,
      raw: {},
      updated_at: "2026-04-02T18:45:48.266Z",
    });
    db.close();

    const server = serveApi(dbPath, { host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const summary = await fetch(`${baseUrl}/v1/summary?scope=wallet_1`).then((response) => response.json());
    const positions = await fetch(`${baseUrl}/v1/positions?scope=wallet_1`).then((response) => response.json());

    expect(summary.total_usd).toBe(50);
    expect(positions.count).toBe(1);

    server.close();
  });
});
