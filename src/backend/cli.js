import { DEFAULT_STATIC_OUT_DIR, DB_PATH, defaultRpcUrl } from "./config.js";
import { serveApi } from "./api.js";
import { applySchema, connect, seedWalletsAndProtocols, summarizeScope } from "./db.js";
import { exportStaticJson } from "./export-static.js";
import { runIngestion } from "./ingestion.js";
import { parseCliArgs, readIntOption, sleep } from "./utils.js";

function usage() {
  return [
    "Usage: node ./src/backend/cli.js <command> [options]",
    "",
    "Commands:",
    "  init-db",
    "  ingest --rpc-url <url>",
    "  ingest-loop --rpc-url <url> --interval-seconds <seconds>",
    "  summary --scope <wallet_1|wallet_2|wallet_3|combined>",
    "  export-static --out-dir <path>",
    "  serve-api --host <host> --port <port>",
  ].join("\n");
}

async function commandInitDb(dbPath) {
  const db = connect(dbPath);
  try {
    applySchema(db);
    seedWalletsAndProtocols(db);
  } finally {
    db.close();
  }
}

async function commandIngest(dbPath, rpcUrl) {
  const db = connect(dbPath);
  try {
    const result = await runIngestion(db, { rpcUrl });
    process.stdout.write(`Ingestion complete: positions_written=${result.positionsWritten}, errors=${result.errors}\n`);
    for (const errorMessage of result.errorMessages) {
      process.stdout.write(`  - ${errorMessage}\n`);
    }
  } finally {
    db.close();
  }
}

async function commandIngestLoop(dbPath, rpcUrl, intervalSeconds) {
  if (intervalSeconds < 5) {
    throw new Error("interval-seconds must be at least 5");
  }

  let runCount = 0;
  while (true) {
    runCount += 1;
    process.stdout.write(`[run ${runCount}] starting ingestion\n`);
    await commandIngest(dbPath, rpcUrl);
    process.stdout.write(`[run ${runCount}] sleeping ${intervalSeconds}s\n`);
    await sleep(intervalSeconds * 1000);
  }
}

async function commandSummary(dbPath, scope) {
  const db = connect(dbPath);
  try {
    const summary = summarizeScope(db, scope);
    process.stdout.write(`scope=${summary.scope} total_usd=${summary.total_usd.toFixed(2)}\n`);
  } finally {
    db.close();
  }
}

async function commandExportStatic(dbPath, outDir) {
  exportStaticJson(dbPath, outDir);
  process.stdout.write(`Wrote static export to ${outDir}\\portfolio-data.json\n`);
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseCliArgs(argv);
  if (!command) {
    throw new Error(usage());
  }

  const dbPath = options.db ?? DB_PATH;

  if (command === "init-db") {
    await commandInitDb(dbPath);
    return;
  }

  if (command === "ingest") {
    await commandIngest(dbPath, options["rpc-url"] ?? defaultRpcUrl());
    return;
  }

  if (command === "ingest-loop") {
    await commandIngestLoop(
      dbPath,
      options["rpc-url"] ?? defaultRpcUrl(),
      readIntOption(options["interval-seconds"], 300),
    );
    return;
  }

  if (command === "summary") {
    await commandSummary(dbPath, options.scope ?? "combined");
    return;
  }

  if (command === "export-static") {
    await commandExportStatic(dbPath, options["out-dir"] ?? DEFAULT_STATIC_OUT_DIR);
    return;
  }

  if (command === "serve-api") {
    serveApi(dbPath, {
      host: options.host ?? "127.0.0.1",
      port: readIntOption(options.port, 8080),
    });
    return;
  }

  throw new Error(usage());
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
