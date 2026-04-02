export const DB_PATH = "portfolio.db";
export const DEFAULT_STATIC_OUT_DIR = "docs/data";
export const SCOPES = ["wallet_1", "wallet_2", "wallet_3", "combined"];
export const DEFAULT_GITHUB_REPOSITORY = "Meciah/wallet_dashboard";
export const DEFAULT_WORKFLOW_URL = `https://github.com/${DEFAULT_GITHUB_REPOSITORY}/actions/workflows/update-data.yml`;

export const TRACKED_WALLETS = [
  { label: "wallet_1", address: "3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R" },
  { label: "wallet_2", address: "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS" },
  { label: "wallet_3", address: "CRsHntQirTYe9zwZYYMJpt6Wm6TaZyncUYF4TgW39zcf" },
];

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const MSOL_MINT = "mSoLzYCxHdYgdzUevW6Y8k9sW5M2YfLQ7fPjYq4Jp7";

export const TOKEN_SYMBOL_OVERRIDES = {
  [SOL_MINT]: "SOL",
  [MSOL_MINT]: "mSOL",
};

export const KNOWN_LP_MINTS = {
  LPPlaceholderMint11111111111111111111111111111111: "LP_PLACEHOLDER",
};

export const RAYDIUM_LP_MINTS = {
  J2RwRUiUafbvJdfNMgEELY4h27gmQtV1YGwDUhez68yu: "RAYDIUM_LP_USER_POOL",
};

export const MARINADE_NATIVE_STAKE_ACCOUNTS = {
  "3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R": [],
  ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS: [],
  CRsHntQirTYe9zwZYYMJpt6Wm6TaZyncUYF4TgW39zcf: [],
};

export const MARINADE_VALIDATOR_VOTE_ACCOUNTS = new Set();

export const COINGECKO_IDS_BY_MINT = {
  [SOL_MINT]: "solana",
  [MSOL_MINT]: "msol",
};

export function defaultRpcUrl() {
  return process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}
