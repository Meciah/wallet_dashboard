import { PublicKey } from "@solana/web3.js";

import { COINGECKO_IDS_BY_MINT, STATIC_PRICE_OVERRIDES, tokenMetadataForMint } from "./config.js";
import { withRetry } from "./utils.js";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const STAKE_PROGRAM_ID = "Stake11111111111111111111111111111111111111";
const LAMPORTS_PER_SOL = 1_000_000_000;

function normalizeAddress(address) {
  return new PublicKey(address).toBase58();
}

function httpError(status, bodyText) {
  const error = new Error(`HTTP Error ${status}: ${bodyText}`);
  error.status = status;
  return error;
}

function normalizeSymbol(symbol, fallback) {
  const value = String(symbol ?? fallback ?? "").trim();
  return value || fallback || null;
}

function mergeQuote(baseQuote, nextQuote) {
  if (!baseQuote) {
    return nextQuote ? { ...nextQuote } : null;
  }

  if (!nextQuote) {
    return { ...baseQuote };
  }

  return {
    ...baseQuote,
    ...Object.fromEntries(Object.entries(nextQuote).filter(([, value]) => value !== undefined && value !== null)),
    priceUsd: baseQuote.priceUsd ?? nextQuote.priceUsd ?? null,
    source: baseQuote.source ?? nextQuote.source ?? null,
    symbol: baseQuote.symbol ?? nextQuote.symbol ?? null,
    name: baseQuote.name ?? nextQuote.name ?? null,
    iconUrl: baseQuote.iconUrl ?? nextQuote.iconUrl ?? null,
    priceChange24h: baseQuote.priceChange24h ?? nextQuote.priceChange24h ?? null,
  };
}

export class SolanaRpcProvider {
  constructor(rpcUrl, { fetchImpl = fetch } = {}) {
    this.rpcUrl = rpcUrl;
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  cached(key, loader) {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const promise = Promise.resolve()
      .then(loader)
      .catch((error) => {
        this.cache.delete(key);
        throw error;
      });

    this.cache.set(key, promise);
    return promise;
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
    return this.cached(`sol:${walletAddress}`, async () => {
      const address = normalizeAddress(walletAddress);
      const result = await this.rpc("getBalance", [address, { commitment: "confirmed" }]);
      return Number(result?.value ?? 0) / LAMPORTS_PER_SOL;
    });
  }

  async getTokenBalances(walletAddress) {
    return this.cached(`tokens:${walletAddress}`, async () => {
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

        const metadata = tokenMetadataForMint(mint);
        balances.push({
          mint,
          amount,
          decimals: Number(tokenAmount.decimals ?? metadata?.decimals ?? 0),
          symbol: metadata?.symbol ?? null,
          name: metadata?.name ?? null,
          icon_url: metadata?.icon_url ?? null,
          state: info.state ?? null,
          token_account: account.pubkey,
        });
      }

      return balances;
    });
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

  async getMarinadeNativeStakeAccounts(walletAddress, stakerAuthority) {
    return this.cached(`marinade-stake:${walletAddress}:${stakerAuthority}`, async () => {
      const result = await this.rpc("getProgramAccounts", [
        STAKE_PROGRAM_ID,
        {
          encoding: "jsonParsed",
          commitment: "confirmed",
          filters: [
            { memcmp: { offset: 12, bytes: normalizeAddress(stakerAuthority) } },
            { memcmp: { offset: 44, bytes: normalizeAddress(walletAddress) } },
          ],
        },
      ]);

      return (result ?? []).map((row) => {
        const info = row?.account?.data?.parsed?.info ?? {};
        const delegation = info.stake?.delegation ?? {};
        const lamports = Number(delegation.stake ?? 0);
        return {
          address: row.pubkey,
          voter: delegation.voter ?? null,
          active_sol: lamports / LAMPORTS_PER_SOL,
          authorized_staker: info.meta?.authorized?.staker ?? null,
          authorized_withdrawer: info.meta?.authorized?.withdrawer ?? null,
        };
      });
    });
  }

  async getSignaturesForAddress(address, limit = 200) {
    const result = await this.rpc("getSignaturesForAddress", [
      normalizeAddress(address),
      { limit, commitment: "confirmed" },
    ]);
    return (result ?? []).map((row) => row.signature).filter(Boolean);
  }

  async getParsedTransaction(signature) {
    return this.rpc("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
  }
}

export class StaticPriceProvider {
  constructor(overrides = STATIC_PRICE_OVERRIDES) {
    this.prices = { ...overrides };
  }

  async getQuote(mint) {
    const metadata = tokenMetadataForMint(mint);
    const priceUsd = this.prices[mint] ?? null;
    if (priceUsd === null && !metadata) {
      return null;
    }

    return {
      mint,
      priceUsd,
      source: "static",
      symbol: metadata?.symbol ?? null,
      name: metadata?.name ?? null,
      iconUrl: metadata?.icon_url ?? null,
      priceChange24h: null,
    };
  }

  async getPriceUsd(mint) {
    return (await this.getQuote(mint))?.priceUsd ?? null;
  }
}

export class CoinGeckoPriceProvider {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  async getQuote(mint) {
    if (this.cache.has(mint)) {
      return this.cache.get(mint);
    }

    const coinId = COINGECKO_IDS_BY_MINT[mint];
    if (!coinId) {
      return null;
    }

    const metadata = tokenMetadataForMint(mint);
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

    const quote = {
      mint,
      priceUsd: Number(price),
      source: "coingecko",
      symbol: metadata?.symbol ?? null,
      name: metadata?.name ?? null,
      iconUrl: metadata?.icon_url ?? null,
      priceChange24h: null,
    };
    this.cache.set(mint, quote);
    return quote;
  }

  async getPriceUsd(mint) {
    return (await this.getQuote(mint))?.priceUsd ?? null;
  }
}

export class DexScreenerPriceProvider {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetch = fetchImpl;
    this.cache = new Map();
  }

  async getQuote(mint) {
    if (this.cache.has(mint)) {
      return this.cache.get(mint);
    }

    const metadata = tokenMetadataForMint(mint);
    const url = `https://api.dexscreener.com/latest/dex/tokens/${mint}`;
    const body = await withRetry(async () => {
      const response = await this.fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) {
        throw httpError(response.status, await response.text());
      }
      return response.json();
    });

    const pairs = (body?.pairs ?? [])
      .filter((pair) => pair.chainId === "solana" && pair?.baseToken?.address === mint)
      .sort((left, right) => {
        const liquidityDiff = Number(right?.liquidity?.usd ?? 0) - Number(left?.liquidity?.usd ?? 0);
        if (liquidityDiff !== 0) {
          return liquidityDiff;
        }
        return Number(right?.volume?.h24 ?? 0) - Number(left?.volume?.h24 ?? 0);
      });

    if (pairs.length === 0) {
      const fallback = metadata
        ? {
            mint,
            priceUsd: null,
            source: null,
            symbol: metadata.symbol ?? null,
            name: metadata.name ?? null,
            iconUrl: metadata.icon_url ?? null,
            priceChange24h: null,
          }
        : null;
      this.cache.set(mint, fallback);
      return fallback;
    }

    const best = pairs[0];
    const quote = {
      mint,
      priceUsd: Number(best.priceUsd ?? 0) || null,
      source: "dexscreener",
      symbol: normalizeSymbol(best?.baseToken?.symbol, metadata?.symbol ?? mint.slice(0, 4)),
      name: normalizeSymbol(best?.baseToken?.name, metadata?.name ?? mint),
      iconUrl: best?.info?.imageUrl ?? metadata?.icon_url ?? null,
      priceChange24h: best?.priceChange?.h24 === undefined ? null : Number(best.priceChange.h24),
      liquidityUsd: best?.liquidity?.usd === undefined ? null : Number(best.liquidity.usd),
      marketCap: best?.marketCap === undefined ? Number(best?.fdv ?? 0) || null : Number(best.marketCap),
      pairAddress: best?.pairAddress ?? null,
      dexId: best?.dexId ?? null,
    };
    this.cache.set(mint, quote);
    return quote;
  }

  async getPriceUsd(mint) {
    return (await this.getQuote(mint))?.priceUsd ?? null;
  }
}

export class FallbackPriceProvider {
  constructor(providers) {
    this.providers = providers;
    this.cache = new Map();
  }

  async getQuote(mint) {
    if (this.cache.has(mint)) {
      return this.cache.get(mint);
    }

    let mergedQuote = null;
    const metadata = tokenMetadataForMint(mint);
    if (metadata) {
      mergedQuote = {
        mint,
        priceUsd: null,
        source: null,
        symbol: metadata.symbol ?? null,
        name: metadata.name ?? null,
        iconUrl: metadata.icon_url ?? null,
        priceChange24h: null,
      };
    }

    for (const provider of this.providers) {
      try {
        const quote = provider.getQuote ? await provider.getQuote(mint) : { mint, priceUsd: await provider.getPriceUsd(mint) };
        mergedQuote = mergeQuote(mergedQuote, quote);
      } catch {
        continue;
      }
    }

    this.cache.set(mint, mergedQuote);
    return mergedQuote;
  }

  async getPriceUsd(mint) {
    return (await this.getQuote(mint))?.priceUsd ?? null;
  }
}
