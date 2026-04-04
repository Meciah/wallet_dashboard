import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { DEFAULT_STATIC_OUT_DIR, SCOPES } from "./config.js";

function normalizeSnapshot(snapshot, fallbackScope) {
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
    total_usd: totalUsd,
    pnl_24h: snapshot.pnl_24h ?? null,
    pnl_7d: snapshot.pnl_7d ?? null,
  };
}

function parseHistoryPayload(payloadText, fallbackScope) {
  try {
    const payload = JSON.parse(payloadText);
    return (payload.history ?? [])
      .map((snapshot) => normalizeSnapshot(snapshot, fallbackScope))
      .filter(Boolean);
  } catch {
    return [];
  }
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

function collectHistoryFromGit(repoRoot, historyDir, scopes, execFileSyncImpl) {
  const snapshots = [];

  for (const scope of scopes) {
    const filePath = resolve(historyDir, `${scope}.json`);
    const relativePath = relative(repoRoot, filePath).replaceAll("\\", "/");
    if (!relativePath || relativePath.startsWith("..")) {
      continue;
    }

    let commits = [];
    try {
      const logOutput = execFileSyncImpl("git", ["log", "--format=%H", "--max-count=400", "--", relativePath], {
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

export function mergeHistorySnapshots(snapshots, scopes = SCOPES, limit = 300) {
  const grouped = Object.fromEntries(scopes.map((scope) => [scope, []]));
  const seen = new Set();

  for (const snapshot of snapshots) {
    if (!snapshot || !scopes.includes(snapshot.scope)) {
      continue;
    }

    const key = `${snapshot.scope}:${snapshot.snapshot_ts}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    grouped[snapshot.scope].push(snapshot);
  }

  for (const scope of scopes) {
    grouped[scope] = grouped[scope]
      .sort((left, right) => new Date(right.snapshot_ts).getTime() - new Date(left.snapshot_ts).getTime())
      .slice(0, limit);
  }

  return grouped;
}

export function loadSeedPortfolioHistory(options = {}) {
  const scopes = options.scopes ?? SCOPES;
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const historyDir = resolve(options.historyDir ?? `${DEFAULT_STATIC_OUT_DIR}/history`);
  const readFileSyncImpl = options.readFileSyncImpl ?? readFileSync;
  const existsSyncImpl = options.existsSyncImpl ?? existsSync;
  const execFileSyncImpl = options.execFileSyncImpl ?? execFileSync;

  const fileSnapshots = collectHistoryFromFiles(historyDir, scopes, readFileSyncImpl, existsSyncImpl);
  const gitSnapshots = collectHistoryFromGit(repoRoot, historyDir, scopes, execFileSyncImpl);
  const grouped = mergeHistorySnapshots([...fileSnapshots, ...gitSnapshots], scopes, options.limit ?? 300);

  return scopes.flatMap((scope) => grouped[scope]);
}