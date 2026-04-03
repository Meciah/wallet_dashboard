export const DB_PATH = "portfolio.db";
export const DEFAULT_STATIC_OUT_DIR = "docs/data";
export const DEFAULT_GITHUB_REPOSITORY = "Meciah/wallet_dashboard";
export const DEFAULT_WORKFLOW_URL = `https://github.com/${DEFAULT_GITHUB_REPOSITORY}/actions/workflows/update-data.yml`;

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const MSOL_MINT = "mSoLzYCxHdYgdzUevW6Y8k9sW5M2YfLQ7fPjYq4Jp7";
export const URMOM_MINT = "9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump";

export const TRACKED_WALLETS = [
  {
    scope: "wallet_1",
    label: "3dhj...VK7R",
    address: "3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R",
    accent: "#7ee787",
  },
  {
    scope: "wallet_2",
    label: "ELKy...caGS",
    address: "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
    accent: "#4ad8ff",
  },
  {
    scope: "wallet_3",
    label: "CRsH...9zcf",
    address: "CRsHntQirTYe9zwZYYMJpt6Wm6TaZyncUYF4TgW39zcf",
    accent: "#b892ff",
  },
];

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
  [URMOM_MINT]: {
    symbol: "URMOM",
    name: "URMOM",
    decimals: 6,
    icon_url: "https://img-v1.raydium.io/icon/9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump.png",
  },
};

export const STATIC_PRICE_OVERRIDES = {
  [SOL_MINT]: 78.65,
};

export const KNOWN_LP_MINTS = {};

export const RAYDIUM_LP_MINTS = {};

export const MARINADE_NATIVE_STAKER_AUTHORITY = "stWirqFCf2Uts1JBL1Jsd3r6VBWhgnpdPxCTe1MFjrq";

export const COINGECKO_IDS_BY_MINT = {
  [SOL_MINT]: "solana",
  [MSOL_MINT]: "marinade-staked-sol",
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
