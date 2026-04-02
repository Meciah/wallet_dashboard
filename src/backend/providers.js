import { PublicKey } from "@solana/web3.js";

import { COINGECKO_IDS_BY_MINT, MSOL_MINT, SOL_MINT } from "./config.js";
import { withRetry } from "./utils.js";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const LAMPORTS_PER_SOL = 1_000_000_000;

function normalizeAddress(address) {
  return new PublicKey(address).toBase58();
}

function httpError(status, bodyText) {
  const error = new Error(`HTTP Error ${status}: ${bodyText}`);
  error.status = status;
  return error;
}

export class SolanaRpcProvider {
  constructor(rpcUrl, { fetchImpl = fetch } = {}) {
    this.rpcUrl = rpcUrl;
    this.fetch = fetchImpl;
  }

  async rpc(method, params) {
    const payload = { jsonrpc: "2.0", id: 1, method, params };

    return withRetry(async () => {
      const response = await this.fetch(this.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw httpError(response.status, await response.text());
      }

      const body = await response.json();
      if (body.error) {
        const error = new Error(`RPC ${method} failed: ${JSON.stringify(body.error)}`);
        error.status = body.error.code;
        throw error;
      }

      return body.result;
    });
  }

  async getSolBalance(walletAddress) {
    const address = normalizeAddress(walletAddress);
    const result = await this.rpc("getBalance", [address, { commitment: "confirmed" }]);
    return Number(result?.value ?? 0) / LAMPORTS_PER_SOL;
  }

  async getTokenBalances(walletAddress) {
    const address = normalizeAddress(walletAddress);
    const result = await this.rpc("getTokenAccountsByOwner", [
      address,
      { programId: TOKEN_PROGRAM_ID },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);

    const balances = [];
    for (const account of result?.value ?? []) {
      const parsed = account?.account?.data?.parsed ?? {};
      const info = parsed.info ?? {};
      const tokenAmount = info.tokenAmount ?? {};
      const amountText = tokenAmount.uiAmountString ?? tokenAmount.uiAmount;
      const mint = info.mint;
      if (amountText === undefined || mint === undefined) {
        continue;
      }

      const amount = Number(amountText);
      if (!Number.isFinite(amount) || amount === 0) {
        continue;
      }

      balances.push({
        mint,
        amount,
        decimals: Number(tokenAmount.decimals ?? 0),
        symbol: null,
      });
    }

    return balances;
  }

  async getParsedMultipleAccounts(addresses) {
    if (addresses.length === 0) {
      return [];
    }

    const result = await this.rpc("getMultipleAccounts", [
      addresses.map((address) => normalizeAddress(address)),
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]);

    const accounts = [];
    for (const [index, account] of (result?.value ?? []).entries()) {
      if (!account) {
        continue;
      }
      accounts.push({ address: addresses[index], account });
    }

    return accounts;
  }

  async getSignaturesForAddress(address, limit = 200) {
    const result = await this.rpc("getSignaturesForAddress", [
      normalizeAddress(address),
      { limit, commitment: "confirmed" },
    ]);
    return (result ?? []).map((row) => row.signature).filter(Boolean);
  }

  async getParsedTransaction(signature) {
    return this.rpc("getTransaction", [
      signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ]);
  }
}

export class StaticPriceProvider {
  constructor(overrides = {}) {
    this.prices = {
      [SOL_MINT]: 0,
      [MSOL_MINT]: 0,
      ...overrides,
    };
  }

  async getPriceUsd(mint) {
    return this.prices[mint] ?? null;
  }
}

export class CoinGeckoPriceProvider {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  async getPriceUsd(mint) {
    if (this.cache.has(mint)) {
      return this.cache.get(mint);
    }

    const coinId = COINGECKO_IDS_BY_MINT[mint];
    if (!coinId) {
      return null;
    }

    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set("ids", coinId);
    url.searchParams.set("vs_currencies", "usd");

    const body = await withRetry(async () => {
      const response = await this.fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) {
        throw httpError(response.status, await response.text());
      }
      return response.json();
    });

    const price = body?.[coinId]?.usd;
    if (price === undefined || price === null) {
      return null;
    }

    const numericPrice = Number(price);
    this.cache.set(mint, numericPrice);
    return numericPrice;
  }
}

export class FallbackPriceProvider {
  constructor(providers) {
    this.providers = providers;
  }

  async getPriceUsd(mint) {
    for (const provider of this.providers) {
      try {
        const price = await provider.getPriceUsd(mint);
        if (price !== null && price !== undefined) {
          return Number(price);
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
