import { execFileSync } from "node:child_process";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { DEFAULT_STATIC_OUT_DIR, HISTORY_SERIES, SCOPES, shouldIgnoreTokenIdentity } from "./config.js";

const HISTORY_SOURCE_PRIORITY = {
  history: 1,
  secureHistory: 2,
  positions: 3,
  securePositions: 4,
};

function normalizeSnapshot(snapshot, fallbackScope, fallbackSeries = HISTORY_SERIES.WITH_LIQUIDITY, sourcePriority = HISTORY_SOURCE_PRIORITY.history) {
  if (!snapshot?.snapshot_ts) {
    return null;
  }

  const timestamp = new Date(snapshot.snapshot_ts).toISOString();
  const totalUsd = Number(snapshot.total_usd ?? 0);
  if (Number.isNaN(totalUsd)) {
    return null;
  }

  return {
    snapshot_ts: timestamp,
    scope: snapshot.scope ?? fallbackScope,
    series: snapshot.series ?? fallbackSeries,
    total_usd: totalUsd,
    pnl_24h: snapshot.pnl_24h ?? null,
    pnl_7d: snapshot.pnl_7d ?? null,
    _sourcePriority: sourcePriority,
  };
}

function parseHistoryPayload(payloadText, fallbackScope, sourcePriority = HISTORY_SOURCE_PRIORITY.history) {
  try {
    const payload = JSON.parse(payloadText);
    const hasSeparateCoreHistory = Array.isArray(payload.history_with_liquidity);
    const history = (payload.history ?? [])
      .map((snapshot) =>
        normalizeSnapshot(
          snapshot,
          fallbackScope,
          hasSeparateCoreHistory ? HISTORY_SERIES.CORE : HISTORY_SERIES.WITH_LIQUIDITY,
          sourcePriority,
        ),
      )
      .filter(Boolean);
    const historyWithLiquidity = (payload.history_with_liquidity ?? [])
      .map((snapshot) => normalizeSnapshot(snapshot, fallbackScope, HISTORY_SERIES.WITH_LIQUIDITY, sourcePriority))
      .filter(Boolean);
    return [...history, ...historyWithLiquidity];
  } catch {
    return [];
  }
}

function readGeneratedTimestamp(payloadText) {
  try {
    const payload = JSON.parse(payloadText);
    const timestamp = payload.latest_run_started_at ?? payload.generated_at ?? payload.last_successful_export_at ?? null;
    return timestamp ? new Date(timestamp).toISOString() : null;
  } catch {
    return null;
  }
}

function hasTokenIdentity(candidate) {
  return Boolean(String(candidate?.mint ?? "").trim() || String(candidate?.symbol ?? "").trim());
}

function positionContainsIgnoredToken(position) {
  const raw = position?.raw ?? {};
  const quantity = Array.isArray(position?.quantity)
    ? position.quantity
    : Array.isArray(raw.quantity)
      ? raw.quantity
      : [];
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
    mint: position?.asset_mint ?? raw.mint,
    symbol: position?.asset_symbol ?? raw.display_symbol,
    name: position?.asset_name ?? raw.display_name,
  };

  return hasTokenIdentity(fallback) && shouldIgnoreTokenIdentity(fallback);
}

function snapshotsFromPositions(positions, scope, snapshotTs, sourcePriority = HISTORY_SOURCE_PRIORITY.positions) {
  if (!snapshotTs) {
    return [];
  }

  let coreTotalUsd = 0;
  let totalUsd = 0;

  for (const position of positions) {
    const usdValue = Number(position?.usd_value ?? 0);
    if (Number.isNaN(usdValue)) {
      continue;
    }

    if (positionContainsIgnoredToken(position)) {
      continue;
    }

    totalUsd += usdValue;
    const protocolCategory = position?.protocol_category ?? position?.raw?.protocol_category ?? null;
    const positionType = position?.position_type ?? position?.raw?.position_type ?? null;
    if (protocolCategory !== "lp" && positionType !== "lp") {
      coreTotalUsd += usdValue;
    }
  }

  return [
    normalizeSnapshot(
      {
        snapshot_ts: snapshotTs,
        scope,
        series: HISTORY_SERIES.WITH_LIQUIDITY,
        total_usd: totalUsd,
      },
      scope,
      HISTORY_SERIES.WITH_LIQUIDITY,
      sourcePriority,
    ),
    normalizeSnapshot(
      {
        snapshot_ts: snapshotTs,
        scope,
        series: HISTORY_SERIES.CORE,
        total_usd: coreTotalUsd,
      },
      scope,
      HISTORY_SERIES.CORE,
      sourcePriority,
    ),
  ].filter(Boolean);
}

function parsePositionsPayload(payloadText, fallbackScope, snapshotTs, sourcePriority = HISTORY_SOURCE_PRIORITY.positions) {
  if (!snapshotTs) {
    return [];
  }

  try {
    const payload = JSON.parse(payloadText);
    if (!Array.isArray(payload.positions)) {
      return [];
    }

    const scope = payload.scope ?? fallbackScope;
    return snapshotsFromPositions(payload.positions, scope, snapshotTs, sourcePriority);
  } catch {
    return [];
  }
}

function dashboardPassword(options = {}) {
  const password = options.password ?? process.env.DASHBOARD_PASSWORD ?? process.env.WALLET_DASHBOARD_PASSWORD ?? "";
  return String(password).trim();
}

function decryptSecurePayload(payloadText, password) {
  if (!password) {
    return null;
  }

  try {
    const payload = JSON.parse(payloadText);
    if (payload?.version !== 1) {
      return null;
    }

    const key = pbkdf2Sync(password, Buffer.from(payload.salt, "base64"), Number(payload.iterations), 32, "sha256");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch {
    return null;
  }
}

function parseAggregateHistoryPayload(payload, scopes, sourcePriority = HISTORY_SOURCE_PRIORITY.secureHistory) {
  const snapshots = [];

  for (const scope of scopes) {
    for (const snapshot of payload?.history?.[scope] ?? []) {
      snapshots.push(normalizeSnapshot(snapshot, scope, HISTORY_SERIES.CORE, sourcePriority));
    }

    for (const snapshot of payload?.history_with_liquidity?.[scope] ?? []) {
      snapshots.push(normalizeSnapshot(snapshot, scope, HISTORY_SERIES.WITH_LIQUIDITY, sourcePriority));
    }
  }

  return snapshots.filter(Boolean);
}

function parseAggregatePositionSnapshots(payload, scopes, sourcePriority = HISTORY_SOURCE_PRIORITY.securePositions) {
  const snapshotTs =
    payload?.generated?.latest_run_started_at ??
    payload?.generated?.generated_at ??
    payload?.generated?.last_successful_export_at ??
    null;
  if (!snapshotTs) {
    return [];
  }

  return scopes.flatMap((scope) => {
    const positions = payload?.positions?.[scope];
    return Array.isArray(positions) ? snapshotsFromPositions(positions, scope, snapshotTs, sourcePriority) : [];
  });
}

function parseSecurePayload(payloadText, scopes, password) {
  const payload = decryptSecurePayload(payloadText, password);
  if (!payload) {
    return [];
  }

  return [...parseAggregatePositionSnapshots(payload, scopes), ...parseAggregateHistoryPayload(payload, scopes)];
}

function collectHistoryFromFiles(historyDir, scopes, readFileSyncImpl, existsSyncImpl) {
  const snapshots = [];

  for (const scope of scopes) {
    const filePath = resolve(historyDir, `${scope}.json`);
    if (!existsSyncImpl(filePath)) {
      continue;
    }

    snapshots.push(...parseHistoryPayload(readFileSyncImpl(filePath, "utf8"), scope));
  }

  return snapshots;
}

function collectHistoryFromGit(repoRoot, historyDir, scopes, execFileSyncImpl, maxGitCommits) {
  const snapshots = [];

  for (const scope of scopes) {
    const filePath = resolve(historyDir, `${scope}.json`);
    const relativePath = relative(repoRoot, filePath).replaceAll("\\", "/");
    if (!relativePath || relativePath.startsWith("..")) {
      continue;
    }

    let commits = [];
    try {
      const logOutput = execFileSyncImpl("git", ["log", "--format=%H", `--max-count=${maxGitCommits}`, "--", relativePath], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      commits = logOutput.split(/\r?\n/).filter(Boolean);
    } catch {
      continue;
    }

    for (const commit of commits) {
      try {
        const historyText = execFileSyncImpl("git", ["show", `${commit}:${relativePath}`], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        snapshots.push(...parseHistoryPayload(historyText, scope));
      } catch {
        continue;
      }
    }
  }

  return snapshots;
}

function collectPositionSnapshotsFromFiles(dataDir, scopes, readFileSyncImpl, existsSyncImpl) {
  const generatedPath = resolve(dataDir, "generated.json");
  if (!existsSyncImpl(generatedPath)) {
    return [];
  }

  const snapshotTs = readGeneratedTimestamp(readFileSyncImpl(generatedPath, "utf8"));
  if (!snapshotTs) {
    return [];
  }

  const snapshots = [];
  for (const scope of scopes) {
    const filePath = resolve(dataDir, "positions", `${scope}.json`);
    if (!existsSyncImpl(filePath)) {
      continue;
    }

    snapshots.push(...parsePositionsPayload(readFileSyncImpl(filePath, "utf8"), scope, snapshotTs));
  }

  return snapshots;
}

function collectPositionSnapshotsFromGit(repoRoot, dataDir, scopes, execFileSyncImpl, maxGitCommits) {
  const snapshots = [];
  const generatedRelativePath = relative(repoRoot, resolve(dataDir, "generated.json")).replaceAll("\\", "/");
  if (!generatedRelativePath || generatedRelativePath.startsWith("..")) {
    return snapshots;
  }

  const generatedTimestampCache = new Map();
  const readCommitTimestamp = (commit, commitDate) => {
    if (generatedTimestampCache.has(commit)) {
      return generatedTimestampCache.get(commit);
    }

    let timestamp = null;
    try {
      const generatedText = execFileSyncImpl("git", ["show", `${commit}:${generatedRelativePath}`], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      timestamp = readGeneratedTimestamp(generatedText);
    } catch {
      timestamp = commitDate ? new Date(commitDate).toISOString() : null;
    }

    generatedTimestampCache.set(commit, timestamp);
    return timestamp;
  };

  for (const scope of scopes) {
    const filePath = resolve(dataDir, "positions", `${scope}.json`);
    const relativePath = relative(repoRoot, filePath).replaceAll("\\", "/");
    if (!relativePath || relativePath.startsWith("..")) {
      continue;
    }

    let commits = [];
    try {
      const logOutput = execFileSyncImpl("git", ["log", "--format=%H %cI", `--max-count=${maxGitCommits}`, "--", relativePath], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      commits = logOutput
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [commit, commitDate] = line.split(" ");
          return { commit, commitDate };
        });
    } catch {
      continue;
    }

    for (const { commit, commitDate } of commits) {
      try {
        const positionsText = execFileSyncImpl("git", ["show", `${commit}:${relativePath}`], {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const snapshotTs = readCommitTimestamp(commit, commitDate);
        snapshots.push(...parsePositionsPayload(positionsText, scope, snapshotTs));
      } catch {
        continue;
      }
    }
  }

  return snapshots;
}

function collectSecureSnapshotsFromFiles(dataDir, scopes, password, readFileSyncImpl, existsSyncImpl) {
  const filePath = resolve(dataDir, "secure-data.json");
  if (!existsSyncImpl(filePath)) {
    return [];
  }

  return parseSecurePayload(readFileSyncImpl(filePath, "utf8"), scopes, password);
}

function collectSecureSnapshotsFromGit(repoRoot, dataDir, scopes, password, execFileSyncImpl, maxGitCommits) {
  const snapshots = [];
  const filePath = resolve(dataDir, "secure-data.json");
  const relativePath = relative(repoRoot, filePath).replaceAll("\\", "/");
  if (!relativePath || relativePath.startsWith("..") || !password) {
    return snapshots;
  }

  let commits = [];
  try {
    const logOutput = execFileSyncImpl("git", ["log", "--format=%H", `--max-count=${maxGitCommits}`, "--", relativePath], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    commits = logOutput.split(/\r?\n/).filter(Boolean);
  } catch {
    return snapshots;
  }

  for (const commit of commits) {
    try {
      const secureText = execFileSyncImpl("git", ["show", `${commit}:${relativePath}`], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      snapshots.push(...parseSecurePayload(secureText, scopes, password));
    } catch {
      continue;
    }
  }

  return snapshots;
}

function trimLegacyTestingSnapshots(history) {
  if (history.length < 3) {
    return history;
  }

  const ascending = [...history].sort((left, right) => new Date(left.snapshot_ts).getTime() - new Date(right.snapshot_ts).getTime());
  const latestTotal = Number(ascending.at(-1)?.total_usd ?? 0);
  if (latestTotal <= 0) {
    return history;
  }

  const legacyFloor = latestTotal * 0.2;
  const firstRealIndex = ascending.findIndex((snapshot) => Number(snapshot.total_usd ?? 0) >= legacyFloor);
  if (firstRealIndex <= 0) {
    return history;
  }

  return ascending.slice(firstRealIndex);
}

export function mergeHistorySnapshots(snapshots, scopes = SCOPES, limit = 300) {
  const grouped = new Map();

  for (const snapshot of snapshots) {
    if (!snapshot || !scopes.includes(snapshot.scope)) {
      continue;
    }

    const series = snapshot.series ?? HISTORY_SERIES.WITH_LIQUIDITY;
    const groupKey = `${snapshot.scope}:${series}`;
    const existing = grouped.get(groupKey) ?? new Map();
    const snapshotSecond = new Date(snapshot.snapshot_ts).toISOString().slice(0, 19);
    const pointKey = `${groupKey}:${snapshotSecond}`;
    const current = existing.get(pointKey);
    const next = { ...snapshot, series };

    if (!current || Number(next._sourcePriority ?? 0) > Number(current._sourcePriority ?? 0)) {
      existing.set(pointKey, next);
    }

    grouped.set(groupKey, existing);
  }

  const merged = [];
  for (const scope of scopes) {
    for (const series of Object.values(HISTORY_SERIES)) {
      const groupKey = `${scope}:${series}`;
      const seriesHistory = [...(grouped.get(groupKey)?.values() ?? [])];

      merged.push(
        ...trimLegacyTestingSnapshots(seriesHistory)
          .sort((left, right) => new Date(right.snapshot_ts).getTime() - new Date(left.snapshot_ts).getTime())
          .slice(0, limit),
      );
    }
  }

  return merged.map(({ _sourcePriority, ...snapshot }) => snapshot);
}
export function loadSeedPortfolioHistory(options = {}) {
  const scopes = options.scopes ?? SCOPES;
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const historyDir = resolve(options.historyDir ?? `${DEFAULT_STATIC_OUT_DIR}/history`);
  const dataDir = resolve(options.dataDir ?? DEFAULT_STATIC_OUT_DIR);
  const password = dashboardPassword(options);
  const maxGitCommits = options.maxGitCommits ?? 120;
  const readFileSyncImpl = options.readFileSyncImpl ?? readFileSync;
  const existsSyncImpl = options.existsSyncImpl ?? existsSync;
  const execFileSyncImpl = options.execFileSyncImpl ?? execFileSync;

  const fileSecureSnapshots = collectSecureSnapshotsFromFiles(dataDir, scopes, password, readFileSyncImpl, existsSyncImpl);
  const gitSecureSnapshots = fileSecureSnapshots.length
    ? []
    : collectSecureSnapshotsFromGit(repoRoot, dataDir, scopes, password, execFileSyncImpl, maxGitCommits);
  const filePositionSnapshots = collectPositionSnapshotsFromFiles(dataDir, scopes, readFileSyncImpl, existsSyncImpl);
  const gitPositionSnapshots = collectPositionSnapshotsFromGit(repoRoot, dataDir, scopes, execFileSyncImpl, maxGitCommits);
  const fileSnapshots = collectHistoryFromFiles(historyDir, scopes, readFileSyncImpl, existsSyncImpl);
  const gitSnapshots = fileSecureSnapshots.length ? [] : collectHistoryFromGit(repoRoot, historyDir, scopes, execFileSyncImpl, maxGitCommits);

  return mergeHistorySnapshots(
    [
      ...fileSecureSnapshots,
      ...gitSecureSnapshots,
      ...filePositionSnapshots,
      ...gitPositionSnapshots,
      ...fileSnapshots,
      ...gitSnapshots,
    ],
    scopes,
    options.limit ?? 300,
  );
}
