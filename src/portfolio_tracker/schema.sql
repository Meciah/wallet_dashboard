PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS protocols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
  mint TEXT PRIMARY KEY,
  symbol TEXT,
  decimals INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS positions_current (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL,
  protocol_id INTEGER NOT NULL,
  position_type TEXT NOT NULL,
  position_key TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  usd_value REAL NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(wallet_id, protocol_id, position_key),
  FOREIGN KEY(wallet_id) REFERENCES wallets(id),
  FOREIGN KEY(protocol_id) REFERENCES protocols(id)
);

CREATE TABLE IF NOT EXISTS positions_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_ts TEXT NOT NULL,
  wallet_id INTEGER NOT NULL,
  protocol_id INTEGER NOT NULL,
  position_key TEXT NOT NULL,
  usd_value REAL NOT NULL,
  quantity_json TEXT NOT NULL,
  rewards_usd REAL NOT NULL DEFAULT 0,
  pnl_usd REAL NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  FOREIGN KEY(wallet_id) REFERENCES wallets(id),
  FOREIGN KEY(protocol_id) REFERENCES protocols(id)
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_ts TEXT NOT NULL,
  scope TEXT NOT NULL,
  total_usd REAL NOT NULL,
  pnl_24h REAL,
  pnl_7d REAL
);

CREATE TABLE IF NOT EXISTS prices (
  mint TEXT NOT NULL,
  asof_ts TEXT NOT NULL,
  price_usd REAL NOT NULL,
  source TEXT NOT NULL,
  confidence REAL,
  PRIMARY KEY (mint, asof_ts)
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  error_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_positions_current_wallet ON positions_current(wallet_id);
CREATE INDEX IF NOT EXISTS idx_positions_snapshots_wallet_time ON positions_snapshots(wallet_id, snapshot_ts);
CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_scope_time ON portfolio_snapshots(scope, snapshot_ts);
