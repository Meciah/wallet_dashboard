import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DB_PATH,
  HISTORY_SERIES,
  TRACKED_WALLETS,
  getWalletMetadata,
  protocolPresentation,
  shouldIgnoreTokenIdentity,
  tokenMetadataForMint,
} from "./config.js";
import { utcNowIso } from "./utils.js";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");
const __dirname = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = resolve(__dirname, "schema.sql");

function normalizeLegacyQuantity(raw) {
  if (!raw) {
    return [];
  }

  if (Array.isArray(raw.quantity)) {
    return raw.quantity;
  }

  if (raw.mint && raw.amount !== undefined) {
    return [
      {
        mint: raw.mint,
        symbol: raw.display_symbol ?? tokenMetadataForMint(raw.mint)?.symbol ?? raw.mint.slice(0, 4),
        name: raw.display_name ?? tokenMetadataForMint(raw.mint)?.name ?? raw.display_symbol ?? raw.mint,
        amount: Number(raw.amount),
        decimals: raw.decimals ?? tokenMetadataForMint(raw.mint)?.decimals ?? null,
        price_usd: raw.unit_price_usd ?? null,
        price_change_24h: raw.price_change_24h ?? null,
        usd_value: raw.usd_value ?? null,
        icon_url: raw.icon_url ?? tokenMetadataForMint(raw.mint)?.icon_url ?? null,
      },
    ];
  }

  return [];
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hasTokenIdentity(candidate) {
  return Boolean(String(candidate?.mint ?? "").trim() || String(candidate?.symbol ?? "").trim());
}

function isIgnoredPositionPayload(raw, quantity = []) {
  const quantityCandidates = quantity
    .map((item) => ({
      mint: item?.mint,
      symbol: item?.symbol,
      name: item?.name,
    }))
    .filter(hasTokenIdentity);

  if (quantityCandidates.length > 0) {
    return quantityCandidates.some((candidate) => shouldIgnoreTokenIdentity(candidate));
  }

  const fallback = {
    mint: raw?.mint,
    symbol: raw?.display_symbol,
    name: raw?.display_name,
  };

  return hasTokenIdentity(fallback) && shouldIgnoreTokenIdentity(fallback);
}

function sumUsd(positions) {
  return positions.reduce((total, position) => total + Number(position.usd_value ?? 0), 0);
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

function ensurePortfolioSnapshotSeriesColumn(db) {
  const columns = db.prepare("PRAGMA table_info(portfolio_snapshots)").all();
  if (!columns.some((column) => column.name === "series")) {
    db.exec(`ALTER TABLE portfolio_snapshots ADD COLUMN series TEXT NOT NULL DEFAULT '${HISTORY_SERIES.WITH_LIQUIDITY}'`);
  }
}

export function applySchema(db, schemaPath = SCHEMA_PATH) {
  const portfolioSnapshotsTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'portfolio_snapshots'")
    .get();
  if (portfolioSnapshotsTable) {
    ensurePortfolioSnapshotSeriesColumn(db);
  }
  db.exec(readFileSync(schemaPath, "utf8"));
  ensurePortfolioSnapshotSeriesColumn(db);
}

export function seedWalletsAndProtocols(db) {
  const insertWallet = db.prepare(`
    INSERT INTO wallets(label, address)
    VALUES(?, ?)
    ON CONFLICT(address) DO UPDATE SET label = excluded.label
  `);

  for (const wallet of TRACKED_WALLETS) {
    insertWallet.run(wallet.scope, wallet.address);
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
  const raw = { ...position.raw, quantity: position.quantity, rewards_usd: position.rewards_usd ?? 0, pnl_usd: position.pnl_usd ?? 0 };

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
    JSON.stringify(raw),
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
  savePortfolioSnapshotSeries(db, summary, HISTORY_SERIES.WITH_LIQUIDITY);
}

export function savePortfolioSnapshotSeries(db, summary, series = HISTORY_SERIES.WITH_LIQUIDITY) {
  db.prepare(`
    INSERT INTO portfolio_snapshots(snapshot_ts, scope, series, total_usd, pnl_24h, pnl_7d)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1
      FROM portfolio_snapshots
      WHERE snapshot_ts = ? AND scope = ? AND COALESCE(series, ?) = ?
    )
  `).run(
    summary.snapshot_ts,
    summary.scope,
    series,
    summary.total_usd,
    summary.pnl_24h ?? null,
    summary.pnl_7d ?? null,
    summary.snapshot_ts,
    summary.scope,
    HISTORY_SERIES.WITH_LIQUIDITY,
    series,
  );
}

export function seedPortfolioSnapshots(db, snapshots = []) {
  for (const snapshot of snapshots) {
    savePortfolioSnapshotSeries(db, snapshot, snapshot.series ?? HISTORY_SERIES.WITH_LIQUIDITY);
  }
}
export function summarizeScope(db, scope) {
  return createSummary(scope, sumUsd(listCurrentPositions(db, scope)));
}

export function summarizeHistoryScope(db, scope) {
  return createSummary(
    scope,
    sumUsd(listCurrentPositions(db, scope).filter((position) => position.protocol_category !== "lp")),
  );
}

export function listCurrentPositions(db, scope) {
  const params = [];
  let query = `
    SELECT
      w.label AS wallet_scope,
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

  return db
    .prepare(query)
    .all(...params)
    .map((row) => {
      const raw = JSON.parse(row.raw_json);
      const quantity = normalizeLegacyQuantity(raw);
      const primary = quantity[0] ?? null;
      const wallet = getWalletMetadata(row.wallet_scope);
      const protocolInfo = protocolPresentation(row.protocol_name);

      return {
        wallet_scope: row.wallet_scope,
        wallet_label: wallet?.label ?? row.wallet_scope,
        wallet_address: row.wallet_address,
        wallet_accent: wallet?.accent ?? null,
        protocol: row.protocol_name,
        protocol_label: protocolInfo.label,
        protocol_section: protocolInfo.section,
        protocol_category: row.protocol_category,
        position_type: row.position_type,
        position_key: row.position_key,
        usd_value: Number(row.usd_value),
        updated_at: row.updated_at,
        quantity,
        asset_mint: primary?.mint ?? raw.mint ?? null,
        asset_symbol: primary?.symbol ?? raw.display_symbol ?? null,
        asset_name: raw.display_name ?? primary?.name ?? raw.display_symbol ?? row.protocol_name,
        icon_url: raw.icon_url ?? primary?.icon_url ?? null,
        unit_price_usd: raw.unit_price_usd ?? primary?.price_usd ?? null,
        price_change_24h: raw.price_change_24h ?? primary?.price_change_24h ?? null,
        rewards_usd: Number(raw.rewards_usd ?? 0),
        raw,
      };
    })
    .filter((position) => !isIgnoredPositionPayload(position.raw, position.quantity));
}

function ignoredSnapshotUsd(db, scope, snapshotTs, series) {
  const params = [snapshotTs];
  let query = `
    SELECT p.category AS protocol_category, ps.usd_value, ps.quantity_json, ps.raw_json
    FROM positions_snapshots ps
    JOIN wallets w ON w.id = ps.wallet_id
    JOIN protocols p ON p.id = ps.protocol_id
    WHERE ps.snapshot_ts = ?
  `;

  if (scope !== "combined") {
    query += " AND w.label = ?";
    params.push(scope);
  }

  if (series === HISTORY_SERIES.CORE) {
    query += " AND p.category != 'lp'";
  }

  return db
    .prepare(query)
    .all(...params)
    .reduce((total, row) => {
      const raw = safeJsonParse(row.raw_json, {});
      const quantity = Array.isArray(raw.quantity) ? raw.quantity : safeJsonParse(row.quantity_json, []);
      return isIgnoredPositionPayload(raw, quantity) ? total + Number(row.usd_value ?? 0) : total;
    }, 0);
}

export function listPortfolioHistory(db, scope, limit = 100, series = HISTORY_SERIES.WITH_LIQUIDITY) {
  const query = `
      SELECT snapshot_ts, scope, COALESCE(series, ?) AS series, total_usd, pnl_24h, pnl_7d
      FROM portfolio_snapshots
      WHERE scope = ? AND COALESCE(series, ?) = ?
      ORDER BY snapshot_ts DESC LIMIT ?
  `;

  return db
    .prepare(query)
    .all(HISTORY_SERIES.WITH_LIQUIDITY, scope, HISTORY_SERIES.WITH_LIQUIDITY, series, limit)
    .map((row) => {
      const ignoredUsd = ignoredSnapshotUsd(db, row.scope, row.snapshot_ts, row.series);
      return {
        snapshot_ts: row.snapshot_ts,
        scope: row.scope,
        series: row.series,
        total_usd: Math.max(0, Number(row.total_usd) - ignoredUsd),
        pnl_24h: row.pnl_24h,
        pnl_7d: row.pnl_7d,
      };
    });
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
    .map((row) => {
      const metadata = tokenMetadataForMint(row.mint);
      return {
        mint: row.mint,
        symbol: metadata?.symbol ?? null,
        name: metadata?.name ?? null,
        icon_url: metadata?.icon_url ?? null,
        asof_ts: row.asof_ts,
        price_usd: Number(row.price_usd),
        source: row.source,
        confidence: row.confidence,
      };
    })
    .filter((price) => !shouldIgnoreTokenIdentity(price));
}

export function listAllocation(db, scope, by = "protocol") {
  if (!["protocol", "wallet"].includes(by)) {
    throw new Error("by must be protocol or wallet");
  }

  const positions = listCurrentPositions(db, scope);

  if (by === "wallet") {
    const grouped = new Map();
    for (const position of positions) {
      const existing = grouped.get(position.wallet_scope) ?? 0;
      grouped.set(position.wallet_scope, existing + Number(position.usd_value ?? 0));
    }

    return [...grouped.entries()]
      .map(([walletScope, totalUsd]) => {
        const wallet = getWalletMetadata(walletScope);
        return {
          wallet_scope: walletScope,
          wallet: wallet?.label ?? walletScope,
          total_usd: totalUsd,
        };
      })
      .sort((left, right) => right.total_usd - left.total_usd);
  }

  const grouped = new Map();
  for (const position of positions) {
    const presentation = protocolPresentation(position.protocol);
    const existing = grouped.get(presentation.section) ?? {
      protocol: presentation.section,
      protocol_label: presentation.label,
      protocols: [],
      total_usd: 0,
    };
    existing.total_usd += Number(position.usd_value ?? 0);
    if (!existing.protocols.includes(position.protocol)) {
      existing.protocols.push(position.protocol);
    }
    grouped.set(presentation.section, existing);
  }

  return [...grouped.values()].sort((left, right) => right.total_usd - left.total_usd);
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

