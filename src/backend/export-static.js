import { execFileSync } from "node:child_process";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  HISTORY_SERIES,
  DEFAULT_GITHUB_REPOSITORY,
  DEFAULT_STATIC_OUT_DIR,
  DEFAULT_WORKFLOW_URL,
  SCOPES,
  TRACKED_TOKENS,
  TRACKED_WALLETS,
} from "./config.js";
import {
  getLatestIngestionRun,
  listAllocation,
  listCurrentPositions,
  listIngestionRuns,
  listLatestPrices,
  listPortfolioHistory,
  summarizeScope,
  withDb,
} from "./db.js";
import { utcNowIso, writeJsonFile } from "./utils.js";

const ENCRYPTION_ITERATIONS = 250_000;

function base64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function encryptJsonPayload(payload, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, ENCRYPTION_ITERATIONS, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: ENCRYPTION_ITERATIONS,
    cipher: "AES-GCM",
    salt: base64(salt),
    iv: base64(iv),
    tag: base64(tag),
    data: base64(ciphertext),
  };
}

function inferRepositoryFromGit() {
  try {
    const remote = execFileSync("git", ["-c", "safe.directory=C:/code/wallet_dashboard", "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const match = remote.match(/github\.com[/:](.+?)(?:\.git)?$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function createGeneratedMetadata(db, generatedAt) {
  const latestRun = getLatestIngestionRun(db);
  const repository = process.env.GITHUB_REPOSITORY ?? inferRepositoryFromGit() ?? DEFAULT_GITHUB_REPOSITORY;
  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const workflowPath = repository ? `${serverUrl}/${repository}/actions/workflows/update-data.yml` : DEFAULT_WORKFLOW_URL;
  const runId = process.env.GITHUB_RUN_ID ?? null;

  return {
    generated_at: generatedAt,
    last_successful_export_at: generatedAt,
    commit_sha: process.env.GITHUB_SHA ?? null,
    repository,
    workflow_url: runId && repository ? `${serverUrl}/${repository}/actions/runs/${runId}` : workflowPath,
    manual_refresh_url: workflowPath,
    latest_run_status: latestRun?.status ?? null,
    latest_run_started_at: latestRun?.started_at ?? null,
    latest_run_ended_at: latestRun?.ended_at ?? null,
    wallets: TRACKED_WALLETS,
    tracked_tokens: TRACKED_TOKENS,
  };
}

function buildAggregatePayload(db, generated) {
  const payload = {
    generated,
    summary: {},
    positions: {},
    allocation_protocol: {},
    allocation_wallet: {},
    history: {},
    history_with_liquidity: {},
    prices: listLatestPrices(db, 500),
    ingestion_runs: listIngestionRuns(db, 100),
  };

  for (const scope of SCOPES) {
    payload.summary[scope] = summarizeScope(db, scope);
    payload.positions[scope] = listCurrentPositions(db, scope);
    payload.allocation_protocol[scope] = listAllocation(db, scope, "protocol");
    payload.allocation_wallet[scope] = listAllocation(db, scope, "wallet");
    payload.history[scope] = listPortfolioHistory(db, scope, 300, HISTORY_SERIES.CORE);
    payload.history_with_liquidity[scope] = listPortfolioHistory(db, scope, 300, HISTORY_SERIES.WITH_LIQUIDITY);
  }

  return payload;
}

function writeSplitPayloads(outDir, aggregate) {
  writeJsonFile(join(outDir, "generated.json"), aggregate.generated);
  writeJsonFile(join(outDir, "prices.json"), {
    count: aggregate.prices.length,
    prices: aggregate.prices,
  });
  writeJsonFile(join(outDir, "ingestion-runs.json"), {
    count: aggregate.ingestion_runs.length,
    runs: aggregate.ingestion_runs,
  });

  for (const scope of SCOPES) {
    writeJsonFile(join(outDir, "summary", `${scope}.json`), {
      scope,
      summary: aggregate.summary[scope],
    });
    writeJsonFile(join(outDir, "positions", `${scope}.json`), {
      scope,
      count: aggregate.positions[scope].length,
      positions: aggregate.positions[scope],
    });
    writeJsonFile(join(outDir, "allocation", "protocol", `${scope}.json`), {
      scope,
      by: "protocol",
      count: aggregate.allocation_protocol[scope].length,
      allocation: aggregate.allocation_protocol[scope],
    });
    writeJsonFile(join(outDir, "allocation", "wallet", `${scope}.json`), {
      scope,
      by: "wallet",
      count: aggregate.allocation_wallet[scope].length,
      allocation: aggregate.allocation_wallet[scope],
    });
    writeJsonFile(join(outDir, "history", `${scope}.json`), {
      scope,
      count: aggregate.history[scope].length,
      history: aggregate.history[scope],
      count_with_liquidity: aggregate.history_with_liquidity[scope].length,
      history_with_liquidity: aggregate.history_with_liquidity[scope],
    });
  }
}

function removePath(path) {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function removePlaintextPayloads(outDir) {
  for (const path of [
    "portfolio-data.json",
    "generated.json",
    "prices.json",
    "ingestion-runs.json",
    "summary",
    "positions",
    "allocation",
    "history",
  ]) {
    removePath(join(outDir, path));
  }
}

function writeEncryptedPayload(outDir, aggregate, password) {
  removePlaintextPayloads(outDir);
  writeJsonFile(join(outDir, "secure-data.json"), encryptJsonPayload(aggregate, password));
}

function dashboardPassword(options = {}) {
  const password = options.password ?? process.env.DASHBOARD_PASSWORD ?? process.env.WALLET_DASHBOARD_PASSWORD ?? "";
  return String(password).trim();
}

export function exportStaticJson(dbPath, outDir = DEFAULT_STATIC_OUT_DIR, options = {}) {
  const absoluteOutDir = resolve(outDir);
  return withDb(dbPath, (db) => {
    const generatedAt = utcNowIso();
    const generated = createGeneratedMetadata(db, generatedAt);
    const aggregate = buildAggregatePayload(db, generated);
    const password = dashboardPassword(options);

    if (password) {
      writeEncryptedPayload(absoluteOutDir, aggregate, password);
    } else {
      removePath(join(absoluteOutDir, "secure-data.json"));
      writeJsonFile(join(absoluteOutDir, "portfolio-data.json"), aggregate);
      writeSplitPayloads(absoluteOutDir, aggregate);
    }
    return aggregate;
  });
}
