// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadSeedPortfolioHistory } from "../src/backend/history-bootstrap.js";

const cleanupPaths = [];

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop(), { recursive: true, force: true });
  }
});

describe("history bootstrap", () => {
  it("merges git history and trims the initial low-value test snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "wallet-dashboard-history-"));
    const historyDir = join(dir, "history");
    const dataDir = join(dir, "data");
    cleanupPaths.push(dir);

    writeJson(join(historyDir, "combined.json"), {
      scope: "combined",
      count: 1,
      history: [
        {
          snapshot_ts: "2026-04-04T12:50:38.400Z",
          scope: "combined",
          total_usd: 33049.98,
          pnl_24h: null,
          pnl_7d: null,
        },
      ],
    });

    const execFileSyncImpl = vi.fn((command, args) => {
      if (command !== "git") {
        throw new Error("unexpected command");
      }

      const joined = args.join(" ");
      if (joined.includes("log") && joined.includes("history/combined.json")) {
        return "headsha\nrealsha\nlegacysha\n";
      }

      if (joined.includes("show") && joined.includes("headsha:history/combined.json")) {
        return JSON.stringify({
          scope: "combined",
          count: 1,
          history: [
            {
              snapshot_ts: "2026-04-04T12:50:38.400Z",
              scope: "combined",
              total_usd: 33049.98,
              pnl_24h: null,
              pnl_7d: null,
            },
          ],
        });
      }

      if (joined.includes("show") && joined.includes("realsha:history/combined.json")) {
        return JSON.stringify({
          scope: "combined",
          count: 1,
          history: [
            {
              snapshot_ts: "2026-04-04T11:53:02.836Z",
              scope: "combined",
              total_usd: 33067.81,
              pnl_24h: null,
              pnl_7d: null,
            },
          ],
        });
      }


      if (joined.includes("show") && joined.includes("legacysha:history/combined.json")) {
        return JSON.stringify({
          scope: "combined",
          count: 1,
          history: [
            {
              snapshot_ts: "2026-04-02T23:57:45.880Z",
              scope: "combined",
              total_usd: 2390.25,
              pnl_24h: null,
              pnl_7d: null,
            },
          ],
        });
      }

      throw new Error(`unexpected git call: ${joined}`);
    });

    const snapshots = loadSeedPortfolioHistory({
      repoRoot: dir,
      historyDir,
      dataDir,
      scopes: ["combined"],
      execFileSyncImpl,
      readFileSyncImpl: readFileSync,
      existsSyncImpl: existsSync,
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      scope: "combined",
      series: "with_liquidity",
      snapshot_ts: "2026-04-04T12:50:38.400Z",
      total_usd: 33049.98,
    });
    expect(snapshots[1]).toMatchObject({
      scope: "combined",
      series: "with_liquidity",
      snapshot_ts: "2026-04-04T11:53:02.836Z",
      total_usd: 33067.81,
    });
  });

  it("rebuilds core history from git-tracked position snapshots while preserving with-liquidity totals", () => {
    const dir = mkdtempSync(join(tmpdir(), "wallet-dashboard-history-"));
    const historyDir = join(dir, "history");
    const dataDir = join(dir, "data");
    cleanupPaths.push(dir);

    const execFileSyncImpl = vi.fn((command, args) => {
      if (command !== "git") {
        throw new Error("unexpected command");
      }

      const joined = args.join(" ");
      if (joined.includes("log") && joined.includes("history/combined.json")) {
        return "";
      }

      if (joined.includes("log") && joined.includes("data/positions/combined.json")) {
        return "newsha 2026-04-28T22:55:40+00:00\noldsha 2026-04-07T14:30:00+00:00\n";
      }

      if (joined.includes("show") && joined.includes("newsha:data/history/combined.json")) {
        return JSON.stringify({
          scope: "combined",
          count: 1,
          history: [
            {
              snapshot_ts: "2026-04-28T22:55:32.130Z",
              scope: "combined",
              total_usd: 125,
            },
          ],
          count_with_liquidity: 1,
          history_with_liquidity: [
            {
              snapshot_ts: "2026-04-28T22:55:32.130Z",
              scope: "combined",
              series: "with_liquidity",
              total_usd: 125,
            },
          ],
        });
      }

      if (joined.includes("show") && joined.includes("oldsha:data/history/combined.json")) {
        throw new Error("legacy commit has no split history");
      }

      if (joined.includes("show") && joined.includes("newsha:data/generated.json")) {
        return JSON.stringify({
          latest_run_started_at: "2026-04-28T22:55:32.130Z",
        });
      }

      if (joined.includes("show") && joined.includes("oldsha:data/generated.json")) {
        return JSON.stringify({
          latest_run_started_at: "2026-04-07T14:29:12.000Z",
        });
      }

      if (joined.includes("show") && joined.includes("newsha:data/positions/combined.json")) {
        return JSON.stringify({
          scope: "combined",
          count: 2,
          positions: [
            { protocol_category: "wallet", position_type: "spot", usd_value: 100 },
            { protocol_category: "lp", position_type: "lp", usd_value: 25 },
          ],
        });
      }

      if (joined.includes("show") && joined.includes("oldsha:data/positions/combined.json")) {
        return JSON.stringify({
          scope: "combined",
          count: 3,
          positions: [
            { protocol_category: "staking", position_type: "staking", usd_value: 80 },
            { protocol_category: "wallet", position_type: "spot", usd_value: 20 },
            { protocol_category: "lp", position_type: "lp", usd_value: 40 },
          ],
        });
      }

      throw new Error(`unexpected git call: ${joined}`);
    });

    const snapshots = loadSeedPortfolioHistory({
      repoRoot: dir,
      historyDir,
      dataDir,
      scopes: ["combined"],
      execFileSyncImpl,
      readFileSyncImpl: readFileSync,
      existsSyncImpl: existsSync,
    });

    expect(snapshots).toEqual([
      {
        snapshot_ts: "2026-04-07T14:29:12.000Z",
        scope: "combined",
        series: "core",
        total_usd: 100,
        pnl_24h: null,
        pnl_7d: null,
      },
    ]);
  });
});
