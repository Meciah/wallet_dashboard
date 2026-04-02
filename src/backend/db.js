import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { DB_PATH, TRACKED_WALLETS } from "./config.js";
import { utcNowIso } from "./utils.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const __dirname = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = resolve(__dirname, "schema.sql");

export function connect(dbPath = DB_PATH) {
  const db = new DatabaseSync(resolve(dbPath));
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

export function withDb(dbPath, callback) {
  const db = connect(dbPath);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

export function applySchema(db, schemaPath = SCHEMA_PATH) {
  db.exec(readFileSync(schemaPath, "utf8"));
}

export function seedWalletsAndProtocols(db) {
  const insertWallet = db.prepare(`
    INSERT INTO wallets(label, address)
    VALUES(?, ?)
    ON CONFLICT(address) DO UPDATE SET label = excluded.label
  `);

  for (const wallet of TRACKED_WALLETS) {
    insertWallet.run(wallet.label, wallet.address);
  }

  const insertProtocol = db.prepare(`
    INSERT INTO protocols(name, category)
    VALUES(?, ?)
    ON CONFLICT(name) DO UPDATE SET category = excluded.category
  `);

  const defaultProtocols = [
    ["wallet_tokens", "wallet"],
    ["marinade", "staking"],
    ["marinade_native", "staking"],
    ["lp_tokens", "lp"],
    ["raydium", "lp"],
  ];

  for (const [name, category] of defaultProtocols) {
    insertProtocol.run(name, category);
  }
}

export function startIngestionRun(db) {
  const result = db
    .prepare("INSERT INTO ingestion_runs(started_at, status, error_count) VALUES(?, 'running', 0)")
    .run(utcNowIso());
  return Number(result.lastInsertRowid);
}

export function finishIngestionRun(db, runId, status, errorCount, notes = "") {
  db.prepare(`
    UPDATE ingestion_runs
    SET ended_at = ?, status = ?, error_count = ?, notes = ?
    WHERE id = ?
  `).run(utcNowIso(), status, errorCount, notes, runId);
}

export function getWalletId(db, walletAddress) {
  const row = db.prepare("SELECT id FROM wallets WHERE address = ?").get(walletAddress);
  if (!row) {
    throw new Error(`Wallet not seeded: ${walletAddress}`);
  }
  return Number(row.id);
}

export function getProtocolId(db, protocolName) {
  const row = db.prepare("SELECT id FROM protocols WHERE name = ?").get(protocolName);
  if (!row) {
    throw new Error(`Protocol not seeded: ${protocolName}`);
  }
  return Number(row.id);
}

export function upsertCurrentPosition(db, position) {
  const walletId = getWalletId(db, position.wallet_address);
  const protocolId = getProtocolId(db, position.protocol);

  db.prepare(`
    INSERT INTO positions_current(
      wallet_id, protocol_id, position_type, position_key,
      raw_json, usd_value, updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wallet_id, protocol_id, position_key)
    DO UPDATE SET
      position_type = excluded.position_type,
      raw_json = excluded.raw_json,
      usd_value = excluded.usd_value,
      updated_at = excluded.updated_at
  `).run(
    walletId,
    protocolId,
    position.position_type,
    position.position_key,
    JSON.stringify(position.raw),
    position.usd_value,
    position.updated_at,
  );
}

export function insertPositionSnapshot(db, position, snapshotTs) {
  const walletId = getWalletId(db, position.wallet_address);
  const protocolId = getProtocolId(db, position.protocol);

  db.prepare(`
    INSERT INTO positions_snapshots(
      snapshot_ts, wallet_id, protocol_id, position_key, usd_value,
      quantity_json, rewards_usd, pnl_usd, raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshotTs,
    walletId,
    protocolId,
    position.position_key,
    position.usd_value,
    JSON.stringify(position.quantity),
    position.rewards_usd ?? 0,
    position.pnl_usd ?? 0,
    JSON.stringify(position.raw),
  );
}

export function savePortfolioSnapshot(db, summary) {
  db.prepare(`
    INSERT INTO portfolio_snapshots(snapshot_ts, scope, total_usd, pnl_24h, pnl_7d)
    VALUES(?, ?, ?, ?, ?)
  `).run(summary.snapshot_ts, summary.scope, summary.total_usd, summary.pnl_24h ?? null, summary.pnl_7d ?? null);
}

function createSummary(scope, totalUsd) {
  return {
    scope,
    total_usd: Number(totalUsd ?? 0),
    snapshot_ts: utcNowIso(),
    pnl_24h: null,
    pnl_7d: null,
  };
}

export function summarizeScope(db, scope) {
  if (scope === "combined") {
    const row = db.prepare("SELECT COALESCE(SUM(usd_value), 0) AS total FROM positions_current").get();
    return createSummary(scope, row?.total);
  }

  const row = db
    .prepare(`
      SELECT COALESCE(SUM(pc.usd_value), 0) AS total
      FROM positions_current pc
      JOIN wallets w ON w.id = pc.wallet_id
      WHERE w.label = ?
    `)
    .get(scope);

  return createSummary(scope, row?.total);
}

export function listCurrentPositions(db, scope) {
  const params = [];
  let query = `
    SELECT
      w.label AS wallet_label,
      w.address AS wallet_address,
      p.name AS protocol_name,
      p.category AS protocol_category,
      pc.position_type,
      pc.position_key,
      pc.usd_value,
      pc.updated_at,
      pc.raw_json
    FROM positions_current pc
    JOIN wallets w ON w.id = pc.wallet_id
    JOIN protocols p ON p.id = pc.protocol_id
  `;

  if (scope !== "combined") {
    query += " WHERE w.label = ?";
    params.push(scope);
  }

  query += " ORDER BY pc.usd_value DESC";

  return db.prepare(query).all(...params).map((row) => ({
    wallet_label: row.wallet_label,
    wallet_address: row.wallet_address,
    protocol: row.protocol_name,
    protocol_category: row.protocol_category,
    position_type: row.position_type,
    position_key: row.position_key,
    usd_value: Number(row.usd_value),
    updated_at: row.updated_at,
    raw: JSON.parse(row.raw_json),
  }));
}

export function listPortfolioHistory(db, scope, limit = 100) {
  return db
    .prepare(`
      SELECT snapshot_ts, scope, total_usd, pnl_24h, pnl_7d
      FROM portfolio_snapshots
      WHERE scope = ?
      ORDER BY snapshot_ts DESC
      LIMIT ?
    `)
    .all(scope, limit)
    .map((row) => ({
      snapshot_ts: row.snapshot_ts,
      scope: row.scope,
      total_usd: Number(row.total_usd),
      pnl_24h: row.pnl_24h,
      pnl_7d: row.pnl_7d,
    }));
}

export function upsertPrice(db, mint, priceUsd, source, confidence = null) {
  db.prepare(`
    INSERT INTO prices(mint, asof_ts, price_usd, source, confidence)
    VALUES (?, ?, ?, ?, ?)
  `).run(mint, utcNowIso(), priceUsd, source, confidence);
}

export function listLatestPrices(db, limit = 200) {
  return db
    .prepare(`
      SELECT p1.mint, p1.asof_ts, p1.price_usd, p1.source, p1.confidence
      FROM prices p1
      JOIN (
        SELECT mint, MAX(asof_ts) AS max_ts
        FROM prices
        GROUP BY mint
      ) p2 ON p1.mint = p2.mint AND p1.asof_ts = p2.max_ts
      ORDER BY p1.asof_ts DESC
      LIMIT ?
    `)
    .all(limit)
    .map((row) => ({
      mint: row.mint,
      asof_ts: row.asof_ts,
      price_usd: Number(row.price_usd),
      source: row.source,
      confidence: row.confidence,
    }));
}

export function listAllocation(db, scope, by = "protocol") {
  if (!["protocol", "wallet"].includes(by)) {
    throw new Error("by must be protocol or wallet");
  }

  const params = [];
  const selectDimension = by === "protocol" ? "p.name" : "w.label";

  let query = `
    SELECT ${selectDimension} AS dim, COALESCE(SUM(pc.usd_value), 0) AS total_usd
    FROM positions_current pc
    JOIN wallets w ON w.id = pc.wallet_id
    JOIN protocols p ON p.id = pc.protocol_id
  `;

  if (scope !== "combined") {
    query += " WHERE w.label = ?";
    params.push(scope);
  }

  query += " GROUP BY dim ORDER BY total_usd DESC";

  return db.prepare(query).all(...params).map((row) =>
    by === "protocol"
      ? { protocol: row.dim, total_usd: Number(row.total_usd) }
      : { wallet: row.dim, total_usd: Number(row.total_usd) },
  );
}

export function listIngestionRuns(db, limit = 50) {
  return db
    .prepare(`
      SELECT id, started_at, ended_at, status, error_count, notes
      FROM ingestion_runs
      ORDER BY id DESC
      LIMIT ?
    `)
    .all(limit)
    .map((row) => ({
      id: Number(row.id),
      started_at: row.started_at,
      ended_at: row.ended_at,
      status: row.status,
      error_count: Number(row.error_count),
      notes: row.notes,
    }));
}

export function getLatestIngestionRun(db) {
  return listIngestionRuns(db, 1)[0] ?? null;
}
