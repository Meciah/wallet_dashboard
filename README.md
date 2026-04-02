# Wallet Dashboard

JavaScript rewrite of the wallet dashboard: a Node.js CLI and local API for Solana portfolio ingestion, plus a React + Vite frontend deployed to GitHub Pages.

## What It Does
- Tracks three configured Solana wallets
- Stores current positions, snapshots, prices, and ingestion runs in SQLite
- Ingests wallet balances, Marinade mSOL exposure, Marinade native stake, Raydium LP allowlist positions, and legacy LP allowlist positions
- Exports both an aggregate static payload and split JSON endpoints for GitHub Pages
- Serves a local read-only API with the same main summary/positions/allocation/history/prices/run views
- Ships a mobile-first React dashboard that queries static JSON on page load

## Runtime
- Node.js 23+
- npm

The backend uses Node's built-in `node:sqlite` module, so the project expects a modern Node release.

## Install
```bash
npm install
```

## Commands
```bash
npm run init-db
npm run ingest -- --rpc-url https://api.mainnet-beta.solana.com
npm run export-static
npm run summary -- --scope combined
npm run serve-api -- --host 127.0.0.1 --port 8080
npm run build
```

## Frontend + Pages Model
- Vite builds the frontend into `docs/`
- Static portfolio data lives in `docs/data/`
- The frontend queries split JSON files on load:
  - `data/generated.json`
  - `data/summary/<scope>.json`
  - `data/positions/<scope>.json`
  - `data/allocation/protocol/<scope>.json`
  - `data/allocation/wallet/<scope>.json`
  - `data/history/<scope>.json`
  - `data/prices.json`
  - `data/ingestion-runs.json`
- `docs/data/portfolio-data.json` remains as the aggregate compatibility artifact

The dashboard includes a manual refresh control that opens the GitHub Actions workflow page and then re-checks published metadata for the next export.

## GitHub Actions
`update-data.yml`:
- runs every 30 minutes
- supports manual dispatch
- installs dependencies
- runs tests
- ingests latest data
- exports static JSON
- builds the React frontend
- commits updated `docs/` assets back to `main`

## Project Layout
- `src/backend/` Node CLI, data access, adapters, ingestion, export, API
- `src/web/` React dashboard source
- `scripts/seed-split-data.js` bootstraps split JSON files from an existing aggregate export
- `scripts/smoke.js` verifies export + build flow with fake ingestion data
- `tests/` Vitest backend, contract, API, provider, and frontend tests

## Notes
- CoinGecko coverage is intentionally limited to the configured mint map, so many wallet tokens may still show `0` USD until more metadata/pricing is added.
- GitHub Pages remains static-only. The public dashboard loads published JSON; it does not execute live ingestion itself.
