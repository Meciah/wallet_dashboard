import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { DEFAULT_GITHUB_REPOSITORY, DEFAULT_WORKFLOW_URL, SCOPES } from "../src/backend/config.js";
import { writeJsonFile } from "../src/backend/utils.js";

const outDir = resolve("docs/data");
const aggregatePath = join(outDir, "portfolio-data.json");

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

if (!existsSync(aggregatePath)) {
  process.stdout.write("No aggregate portfolio-data.json found; nothing to split.\n");
  process.exit(0);
}

const aggregate = JSON.parse(readFileSync(aggregatePath, "utf8"));
const generatedAt = aggregate.generated?.generated_at ?? aggregate.summary?.combined?.snapshot_ts ?? new Date().toISOString();
const repository = aggregate.generated?.repository ?? inferRepositoryFromGit() ?? DEFAULT_GITHUB_REPOSITORY;
const workflowUrl = repository ? `https://github.com/${repository}/actions/workflows/update-data.yml` : DEFAULT_WORKFLOW_URL;
aggregate.generated = {
  generated_at: generatedAt,
  last_successful_export_at: generatedAt,
  commit_sha: aggregate.generated?.commit_sha ?? null,
  repository,
  workflow_url: aggregate.generated?.workflow_url ?? workflowUrl,
  manual_refresh_url: aggregate.generated?.manual_refresh_url ?? workflowUrl,
  latest_run_status: aggregate.ingestion_runs?.[0]?.status ?? null,
  latest_run_started_at: aggregate.ingestion_runs?.[0]?.started_at ?? null,
  latest_run_ended_at: aggregate.ingestion_runs?.[0]?.ended_at ?? null,
};

writeJsonFile(join(outDir, "generated.json"), aggregate.generated);
writeJsonFile(join(outDir, "prices.json"), {
  count: aggregate.prices?.length ?? 0,
  prices: aggregate.prices ?? [],
});
writeJsonFile(join(outDir, "ingestion-runs.json"), {
  count: aggregate.ingestion_runs?.length ?? 0,
  runs: aggregate.ingestion_runs ?? [],
});

for (const scope of SCOPES) {
  writeJsonFile(join(outDir, "summary", `${scope}.json`), {
    scope,
    summary: aggregate.summary?.[scope] ?? null,
  });
  writeJsonFile(join(outDir, "positions", `${scope}.json`), {
    scope,
    count: aggregate.positions?.[scope]?.length ?? 0,
    positions: aggregate.positions?.[scope] ?? [],
  });
  writeJsonFile(join(outDir, "allocation", "protocol", `${scope}.json`), {
    scope,
    by: "protocol",
    count: aggregate.allocation_protocol?.[scope]?.length ?? 0,
    allocation: aggregate.allocation_protocol?.[scope] ?? [],
  });
  writeJsonFile(join(outDir, "allocation", "wallet", `${scope}.json`), {
    scope,
    by: "wallet",
    count: aggregate.allocation_wallet?.[scope]?.length ?? 0,
    allocation: aggregate.allocation_wallet?.[scope] ?? [],
  });
  writeJsonFile(join(outDir, "history", `${scope}.json`), {
    scope,
    count: aggregate.history?.[scope]?.length ?? 0,
    history: aggregate.history?.[scope] ?? [],
  });
}

writeJsonFile(aggregatePath, aggregate);
process.stdout.write("Split static data written to docs/data.\n");
