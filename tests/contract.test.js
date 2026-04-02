// @vitest-environment node

import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { exportStaticJson } from "../src/backend/export-static.js";
import { applySchema, connect, seedWalletsAndProtocols, upsertCurrentPosition } from "../src/backend/db.js";

const cleanupPaths = [];

function normalizePayload(payload) {
  const normalized = structuredClone(payload);
  normalized.generated.generated_at = "<ts>";
  normalized.generated.last_successful_export_at = "<ts>";
  normalized.generated.repository = "<repo>";
  normalized.generated.workflow_url = "<workflow-url>";
  normalized.generated.manual_refresh_url = "<workflow-url>";
  for (const scope of Object.keys(normalized.summary)) {
    normalized.summary[scope].snapshot_ts = "<ts>";
  }
  return normalized;
}

afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop(), { recursive: true, force: true });
  }
});

describe("export contract", () => {
  it("matches the frozen aggregate export fixture and writes split files", () => {
    const dir = mkdtempSync(join(tmpdir(), "wallet-dashboard-contract-"));
    cleanupPaths.push(dir);
    const dbPath = join(dir, "portfolio.db");
    const outDir = join(dir, "out");

    const db = connect(dbPath);
    applySchema(db);
    seedWalletsAndProtocols(db);
    upsertCurrentPosition(db, {
      wallet_address: "3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R",
      protocol: "wallet_tokens",
      position_type: "wallet_balance",
      position_key: "contract-position",
      quantity: [{ mint: "mint-1", symbol: "M1", amount: 1 }],
      usd_value: 50,
      raw: { source: "fixture" },
      updated_at: "2026-04-02T18:45:48.266Z",
    });
    db.close();

    const aggregate = exportStaticJson(dbPath, outDir);
    const expected = JSON.parse(readFileSync(new URL("./fixtures/contract-export.json", import.meta.url), "utf8"));

    expect(normalizePayload(aggregate)).toEqual(expected);
    expect(existsSync(join(outDir, "summary", "combined.json"))).toBe(true);
    expect(existsSync(join(outDir, "positions", "wallet_1.json"))).toBe(true);
  });
});
