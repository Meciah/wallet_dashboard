# Wallet Dashboard (SQLite-first)

Personal Solana portfolio tracker for three wallets with a SQLite backend.

## Tracked wallets
- `3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R`
- `ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS`
- `CRsHntQirTYe9zwZYYMJpt6Wm6TaZyncUYF4TgW39zcf`

## Current implementation status
This implementation now includes:
- Canonical position model
- SQLite schema + migrations
- Wallet/protocol seed data
- Ingestion runner with pluggable protocol adapters
- Portfolio summary aggregation for per-wallet and combined scopes
- Solana RPC-backed wallet token ingestion (native SOL + SPL token balances)
- Marinade exposure detection via mSOL wallet balance
- Marinade native stake tracking with auto-discovery from wallet stake instructions (+ optional configured stake-account list)
- Raydium LP tracking via dedicated mint allowlist
- Legacy generic LP token detection via configurable mint allowlist (`KNOWN_LP_MINTS`)
- Price provider fallback chain (CoinGecko -> Static fallback) + persisted price history
- Read-only local HTTP API for summaries, positions, allocation, price/history, and ingestion run status
- Static export + GitHub Pages mobile UI scaffold (`docs/`)

## Quick start
```bash
PYTHONPATH=src python -m portfolio_tracker init-db
PYTHONPATH=src python -m portfolio_tracker ingest --rpc-url https://api.mainnet-beta.solana.com
PYTHONPATH=src python -m portfolio_tracker export-static --out-dir docs/data
PYTHONPATH=src python -m portfolio_tracker ingest-loop --rpc-url https://api.mainnet-beta.solana.com --interval-seconds 300
PYTHONPATH=src python -m portfolio_tracker summary --scope combined
PYTHONPATH=src python -m portfolio_tracker serve-api --host 127.0.0.1 --port 8080
```

API examples:
```bash
curl 'http://127.0.0.1:8080/health'
curl 'http://127.0.0.1:8080/v1/summary?scope=combined'
curl 'http://127.0.0.1:8080/v1/positions?scope=wallet_2'
curl 'http://127.0.0.1:8080/v1/history?scope=combined&limit=50'
curl 'http://127.0.0.1:8080/v1/prices?limit=100'
curl 'http://127.0.0.1:8080/v1/allocation?scope=combined&by=protocol'
curl 'http://127.0.0.1:8080/v1/ingestion-runs?limit=20'
```

## GitHub Pages / mobile setup
1. Set repo Pages source to `/docs` (main branch).
2. Add `SOLANA_RPC_URL` as a GitHub Actions repository secret.
3. Add a GitHub Action workflow to run `init-db`, `ingest`, and `export-static` on a schedule (every 30 minutes).
4. Open the Pages URL on phone and "Add to Home Screen".

The workflow updates `docs/data/portfolio-data.json` which powers the mobile dashboard.

> If your environment blocks outbound RPC traffic, ingestion will still run and report per-adapter errors.

## Raydium LP + Marinade native configuration
In `src/portfolio_tracker/config.py`:
- `RAYDIUM_LP_MINTS = { mint: "pool_name" }`
- `MARINADE_NATIVE_STAKE_ACCOUNTS = { wallet_address: [stake_account_pubkeys...] }` (optional override/augment)
- `MARINADE_VALIDATOR_VOTE_ACCOUNTS = { vote_pubkey, ... }` (optional filter)

Add your real Raydium LP mints and native stake account addresses for accurate tracking.

## Project structure
- `src/portfolio_tracker/schema.sql` – full SQLite schema
- `src/portfolio_tracker/db.py` – DB connection, schema apply, seed, persistence/query helpers
- `src/portfolio_tracker/models.py` – canonical dataclasses for normalized positions/snapshots
- `src/portfolio_tracker/adapters/` – protocol adapters
- `src/portfolio_tracker/providers.py` – Solana RPC + price providers
- `src/portfolio_tracker/ingestion.py` – ingestion orchestration and snapshot generation
- `src/portfolio_tracker/export_static.py` – static JSON exporter for Pages/mobile
- `src/portfolio_tracker/api.py` – read-only HTTP API server
- `src/portfolio_tracker/cli.py` – command-line entrypoint
- `docs/` – mobile-friendly static dashboard (GitHub Pages)

## Next steps
1. Replace mint-allowlist LP tracking with full Raydium pool/position decoding (including fee APR + IL estimates).
2. Auto-discover Marinade native stake accounts from wallet activity instead of manual stake account config.
3. Add token metadata enrichment (symbol/logo/verification) and confidence scoring.
