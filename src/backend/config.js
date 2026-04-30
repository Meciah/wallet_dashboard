export const DB_PATH = "portfolio.db";
export const DEFAULT_STATIC_OUT_DIR = "docs/data";
export const DEFAULT_GITHUB_REPOSITORY = "Meciah/wallet_dashboard";
export const DEFAULT_WORKFLOW_URL = `https://github.com/${DEFAULT_GITHUB_REPOSITORY}/actions/workflows/update-data.yml`;
export const HISTORY_SERIES = {
  CORE: "core",
  WITH_LIQUIDITY: "with_liquidity",
};

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const MSOL_MINT = "mSoLzYCxHdYgdzUevW6Y8k9sW5M2YfLQ7fPjYq4Jp7";
export const PUMP_MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
export const URMOM_MINT = "9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump";
export const ALLOWED_TOKEN_MINTS = [SOL_MINT, PUMP_MINT, URMOM_MINT];
export const ALLOWED_TOKEN_SYMBOLS = ["SOL", "PUMP", "URMOM"];

const DEFAULT_WALLET_ACCENTS = ["#7ee787", "#4ad8ff", "#b892ff"];
const DEMO_TRACKED_WALLETS = [
  {
    scope: "wallet_1",
    label: "9Bwg...RrkJ",
    address: "9BwgiKbqpCx8pMAMBrJmuvPBJRc617pyD78tG2eMRrkJ",
    accent: "#7ee787",
  },
  {
    scope: "wallet_2",
    label: "6kFs...EGDM",
    address: "6kFs7GfByyVNNr6YdH9r4m5wzUJHn21Cf7KXA9RREGDM",
    accent: "#4ad8ff",
  },
  {
    scope: "wallet_3",
    label: "8ymi...mTXV",
    address: "8ymirZNvy4ESdFEG3g3RFaky6jX3qLzv5RdCPvhLmTXV",
    accent: "#b892ff",
  },
];

function shortAddress(address) {
  return address ? `${address.slice(0, 4)}...${address.slice(-4)}` : "Wallet";
}

function normalizeTrackedWallet(wallet, index) {
  const address = String(wallet?.address ?? "").trim();
  if (!address) {
    throw new Error(`TRACKED_WALLETS_JSON wallet ${index + 1} is missing an address`);
  }

  return {
    scope: String(wallet.scope ?? `wallet_${index + 1}`).trim(),
    label: String(wallet.label ?? shortAddress(address)).trim(),
    address,
    accent: String(wallet.accent ?? DEFAULT_WALLET_ACCENTS[index % DEFAULT_WALLET_ACCENTS.length]).trim(),
  };
}

export function parseTrackedWallets(value) {
  if (!value) {
    return DEMO_TRACKED_WALLETS;
  }

  const wallets = JSON.parse(value);
  if (!Array.isArray(wallets) || wallets.length === 0) {
    throw new Error("TRACKED_WALLETS_JSON must be a non-empty JSON array");
  }

  return wallets.map(normalizeTrackedWallet);
}

export const TRACKED_WALLETS = parseTrackedWallets(process.env.TRACKED_WALLETS_JSON);
export const SCOPES = [...TRACKED_WALLETS.map((wallet) => wallet.scope), "combined"];

export const WALLET_METADATA_BY_SCOPE = Object.fromEntries(
  TRACKED_WALLETS.map((wallet) => [wallet.scope, { ...wallet, short_address: wallet.label }]),
);

export const WALLET_METADATA_BY_ADDRESS = Object.fromEntries(TRACKED_WALLETS.map((wallet) => [wallet.address, wallet]));

export const TOKEN_METADATA_OVERRIDES = {
  [SOL_MINT]: {
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    icon_url: "https://img-v1.raydium.io/icon/So11111111111111111111111111111111111111112.png",
  },
  [MSOL_MINT]: {
    symbol: "mSOL",
    name: "Marinade Staked SOL",
    decimals: 9,
    icon_url: "https://storage.googleapis.com/marinade-static-assets/msol-token.png",
  },
  [PUMP_MINT]: {
    symbol: "PUMP",
    name: "Pump",
    decimals: 6,
    icon_url: "https://coin-images.coingecko.com/coins/images/67164/large/pump.jpg",
  },
  [URMOM_MINT]: {
    symbol: "URMOM",
    name: "URMOM",
    decimals: 6,
    icon_url: "https://img-v1.raydium.io/icon/9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump.png",
  },
};

export const TRACKED_TOKENS = [PUMP_MINT, URMOM_MINT]
  .map((mint) => {
    const metadata = TOKEN_METADATA_OVERRIDES[mint];
    return metadata ? { mint, ...metadata } : null;
  })
  .filter(Boolean);

export const STATIC_PRICE_OVERRIDES = {
  [SOL_MINT]: 78.65,
};

export const KNOWN_LP_MINTS = {};

export const RAYDIUM_LP_MINTS = {};

export const MARINADE_NATIVE_STAKER_AUTHORITY = "stWirqFCf2Uts1JBL1Jsd3r6VBWhgnpdPxCTe1MFjrq";

export const COINGECKO_IDS_BY_MINT = {
  [SOL_MINT]: "solana",
  [MSOL_MINT]: "marinade-staked-sol",
  [PUMP_MINT]: "pump-fun",
};

export function defaultRpcUrl() {
  return process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}

export function getWalletMetadata(scopeOrAddress) {
  return WALLET_METADATA_BY_SCOPE[scopeOrAddress] ?? WALLET_METADATA_BY_ADDRESS[scopeOrAddress] ?? null;
}

export function walletLabelForScope(scope) {
  return getWalletMetadata(scope)?.label ?? scope;
}

export function protocolPresentation(protocol) {
  if (protocol === "wallet_tokens") {
    return { label: "Holdings", section: "holdings", category: "wallet" };
  }

  if (protocol === "marinade" || protocol === "marinade_native") {
    return { label: "Marinade", section: "marinade", category: "staking" };
  }

  if (protocol === "raydium") {
    return { label: "Raydium", section: "raydium", category: "lp" };
  }

  if (protocol === "lp_tokens") {
    return { label: "LP", section: "lp", category: "lp" };
  }

  return {
    label: protocol.replace(/_/g, " ").replace(/\b\w/g, (value) => value.toUpperCase()),
    section: protocol,
    category: "other",
  };
}

export function tokenMetadataForMint(mint) {
  return TOKEN_METADATA_OVERRIDES[mint] ?? null;
}

export function isAllowedTokenIdentity(token = {}) {
  const mint = String(token?.mint ?? "").trim();
  if (mint) {
    return ALLOWED_TOKEN_MINTS.includes(mint);
  }

  const symbol = String(token?.symbol ?? "").trim().toUpperCase();
  return Boolean(symbol && ALLOWED_TOKEN_SYMBOLS.includes(symbol));
}

export function shouldIgnoreTokenIdentity(token = {}) {
  const mint = String(token?.mint ?? "").trim();
  const symbol = String(token?.symbol ?? "").trim();
  if (!mint && !symbol) {
    return false;
  }

  return !isAllowedTokenIdentity({ mint, symbol });
}
