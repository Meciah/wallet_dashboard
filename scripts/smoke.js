import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { applySchema, connect, seedWalletsAndProtocols } from "../src/backend/db.js";
import { exportStaticJson } from "../src/backend/export-static.js";
import { runIngestion } from "../src/backend/ingestion.js";

class FakeChainProvider {
  constructor() {
    this.rpcUrl = "https://unused.local";
  }

  async getSolBalance() {
    return 1;
  }

  async getTokenBalances() {
    return [{ mint: "So11111111111111111111111111111111111111112", amount: 1, decimals: 9, symbol: "SOL" }];
  }

  async getMarinadeNativeStakeAccounts() {
    return [];
  }

  async getParsedMultipleAccounts() {
    return [];
  }

  async getSignaturesForAddress() {
    return [];
  }

  async getParsedTransaction() {
    return null;
  }
}

class FakePriceProvider {
  async getQuote(mint) {
    return {
      mint,
      priceUsd: 100,
      symbol: "SOL",
      name: "Solana",
      priceChange24h: 0,
    };
  }

  async getPriceUsd() {
    return 100;
  }
}

const tempDir = mkdtempSync(join(tmpdir(), "wallet-dashboard-smoke-"));

try {
  const dbPath = join(tempDir, "portfolio.db");
  const outDir = join(tempDir, "data");
  const db = connect(dbPath);
  applySchema(db);
  seedWalletsAndProtocols(db);
  await runIngestion(db, {
    chainProvider: new FakeChainProvider(),
    priceProvider: new FakePriceProvider(),
    rpcUrl: "https://unused.local",
  });
  db.close();

  exportStaticJson(dbPath, outDir);

  const build = spawnSync(process.execPath, [join(process.cwd(), "node_modules", "vite", "bin", "vite.js"), "build"], {
    cwd: process.cwd(),
    stdio: "inherit",
  });

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  if (!existsSync(join(outDir, "summary", "combined.json"))) {
    throw new Error("Smoke export did not write combined summary JSON.");
  }

  if (!existsSync(join(process.cwd(), "docs", "index.html"))) {
    throw new Error("Vite build did not write docs/index.html.");
  }

  const builtHtml = readFileSync(join(process.cwd(), "docs", "index.html"), "utf8");
  if (!builtHtml.includes("assets/")) {
    throw new Error("Built app index.html does not look like a Vite build output.");
  }

  process.stdout.write("Smoke check passed.\n");
} finally {
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Best-effort cleanup on Windows. The smoke result should not be marked failed because a temp dir is briefly locked.
  }
}
