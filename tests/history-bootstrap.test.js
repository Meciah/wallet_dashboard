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
  it("merges current files with git history and deduplicates snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "wallet-dashboard-history-"));
    const historyDir = join(dir, "history");
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
        return "headsha\noldsha\n";
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

      if (joined.includes("show") && joined.includes("oldsha:history/combined.json")) {
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

      throw new Error(`unexpected git call: ${joined}`);
    });

    const snapshots = loadSeedPortfolioHistory({
      repoRoot: dir,
      historyDir,
      scopes: ["combined"],
      execFileSyncImpl,
      readFileSyncImpl: readFileSync,
      existsSyncImpl: existsSync,
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toMatchObject({
      scope: "combined",
      snapshot_ts: "2026-04-04T12:50:38.400Z",
      total_usd: 33049.98,
    });
    expect(snapshots[1]).toMatchObject({
      scope: "combined",
      snapshot_ts: "2026-04-04T11:53:02.836Z",
      total_usd: 33067.81,
    });
  });
});