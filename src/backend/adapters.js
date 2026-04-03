import { Connection, PublicKey } from "@solana/web3.js";
import { PositionUtils, Raydium } from "@raydium-io/raydium-sdk-v2";

import {
  KNOWN_LP_MINTS,
  MARINADE_NATIVE_STAKER_AUTHORITY,
  MSOL_MINT,
  RAYDIUM_LP_MINTS,
  SOL_MINT,
  tokenMetadataForMint,
} from "./config.js";
import { utcNowIso, withRetry } from "./utils.js";

function safeNumber(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function decimalAmount(value, decimals = 0) {
  if (value === null || value === undefined) {
    return 0;
  }

  const numeric = safeNumber(typeof value?.toString === "function" ? value.toString() : value, 0);
  return numeric / 10 ** Number(decimals ?? 0);
}

function quantityComponent({ mint, symbol, amount, name, iconUrl, decimals, priceUsd, priceChange24h, usdValue }) {
  return {
    mint,
    symbol,
    amount,
    name: name ?? symbol,
    icon_url: iconUrl ?? null,
    decimals: decimals ?? null,
    price_usd: priceUsd ?? null,
    price_change_24h: priceChange24h ?? null,
    usd_value: usdValue ?? null,
  };
}

function buildDisplayName(quantity, fallback) {
  if (quantity.length === 0) {
    return fallback;
  }

  if (quantity.length === 1) {
    return quantity[0].name ?? quantity[0].symbol ?? fallback;
  }

  return quantity.map((item) => item.symbol ?? item.name ?? item.mint.slice(0, 4)).join(" / ");
}

function buildDisplaySymbol(quantity, fallback) {
  if (quantity.length === 0) {
    return fallback;
  }

  if (quantity.length === 1) {
    return quantity[0].symbol ?? fallback;
  }

  return quantity.map((item) => item.symbol ?? item.mint.slice(0, 4)).join("/");
}

function createPosition({
  walletAddress,
  protocol,
  positionType,
  positionKey,
  quantity,
  usdValue,
  raw,
  rewardsUsd = 0,
  pnlUsd = 0,
}) {
  const displayName = raw.display_name ?? buildDisplayName(quantity, positionType);
  const displaySymbol = raw.display_symbol ?? buildDisplaySymbol(quantity, protocol);
  const payloadRaw = {
    ...raw,
    display_name: displayName,
    display_symbol: displaySymbol,
    quantity,
  };

  return {
    wallet_address: walletAddress,
    protocol,
    position_type: positionType,
    position_key: positionKey,
    quantity,
    usd_value: usdValue,
    rewards_usd: rewardsUsd,
    pnl_usd: pnlUsd,
    raw: payloadRaw,
    updated_at: utcNowIso(),
  };
}

export class WalletTokenAdapter {
  constructor(chainProvider, priceProvider) {
    this.protocolName = "wallet_tokens";
    this.chainProvider = chainProvider;
    this.priceProvider = priceProvider;
  }

  shouldSkipToken(token, quote) {
    if (token.mint === MSOL_MINT) {
      return true;
    }

    if (KNOWN_LP_MINTS[token.mint] || RAYDIUM_LP_MINTS[token.mint]) {
      return true;
    }

    const collectibleCandidate = token.decimals === 0 && token.amount === 1;
    if (collectibleCandidate && !quote?.priceUsd) {
      return true;
    }

    return false;
  }

  async collectPositions(walletAddress) {
    const positions = [];

    const solQuote = (await this.priceProvider.getQuote(SOL_MINT)) ?? {};
    const solAmount = await this.chainProvider.getSolBalance(walletAddress);
    positions.push(
      createPosition({
        walletAddress,
        protocol: this.protocolName,
        positionType: "wallet_balance",
        positionKey: `${walletAddress}:native:${SOL_MINT}`,
        quantity: [
          quantityComponent({
            mint: SOL_MINT,
            symbol: solQuote.symbol ?? "SOL",
            name: solQuote.name ?? "Solana",
            amount: solAmount,
            iconUrl: solQuote.iconUrl ?? null,
            decimals: 9,
            priceUsd: solQuote.priceUsd ?? null,
            priceChange24h: solQuote.priceChange24h ?? null,
            usdValue: solAmount * safeNumber(solQuote.priceUsd),
          }),
        ],
        usdValue: solAmount * safeNumber(solQuote.priceUsd),
        raw: {
          mint: SOL_MINT,
          amount: String(solAmount),
          unit_price_usd: solQuote.priceUsd ?? null,
          price_change_24h: solQuote.priceChange24h ?? null,
          icon_url: solQuote.iconUrl ?? null,
          display_name: solQuote.name ?? "Solana",
          display_symbol: solQuote.symbol ?? "SOL",
        },
      }),
    );

    const tokenBalances = await this.chainProvider.getTokenBalances(walletAddress);
    for (const token of tokenBalances) {
      const quote = await this.priceProvider.getQuote(token.mint);
      if (this.shouldSkipToken(token, quote)) {
        continue;
      }

      const metadata = tokenMetadataForMint(token.mint);
      const symbol = quote?.symbol ?? token.symbol ?? metadata?.symbol ?? token.mint.slice(0, 4);
      const name = quote?.name ?? token.name ?? metadata?.name ?? symbol;
      const priceUsd = quote?.priceUsd ?? null;
      const usdValue = token.amount * safeNumber(priceUsd);
      positions.push(
        createPosition({
          walletAddress,
          protocol: this.protocolName,
          positionType: "wallet_balance",
          positionKey: `${walletAddress}:token:${token.mint}`,
          quantity: [
            quantityComponent({
              mint: token.mint,
              symbol,
              name,
              amount: token.amount,
              iconUrl: quote?.iconUrl ?? token.icon_url ?? metadata?.icon_url ?? null,
              decimals: token.decimals,
              priceUsd,
              priceChange24h: quote?.priceChange24h ?? null,
              usdValue,
            }),
          ],
          usdValue,
          raw: {
            mint: token.mint,
            amount: String(token.amount),
            decimals: token.decimals,
            state: token.state ?? null,
            unit_price_usd: priceUsd,
            price_change_24h: quote?.priceChange24h ?? null,
            icon_url: quote?.iconUrl ?? token.icon_url ?? metadata?.icon_url ?? null,
            display_name: name,
            display_symbol: symbol,
          },
        }),
      );
    }

    return positions;
  }
}

export class MarinadeAdapter {
  constructor(chainProvider, priceProvider) {
    this.protocolName = "marinade";
    this.chainProvider = chainProvider;
    this.priceProvider = priceProvider;
  }

  async collectPositions(walletAddress) {
    const tokenBalances = await this.chainProvider.getTokenBalances(walletAddress);
    const msolBalance = tokenBalances.find((balance) => balance.mint === MSOL_MINT);
    if (!msolBalance) {
      return [];
    }

    const quote = (await this.priceProvider.getQuote(MSOL_MINT)) ?? {};
    const usdValue = msolBalance.amount * safeNumber(quote.priceUsd);
    return [
      createPosition({
        walletAddress,
        protocol: this.protocolName,
        positionType: "staking",
        positionKey: `${walletAddress}:marinade:${MSOL_MINT}`,
        quantity: [
          quantityComponent({
            mint: MSOL_MINT,
            symbol: quote.symbol ?? "mSOL",
            name: quote.name ?? "Marinade Staked SOL",
            amount: msolBalance.amount,
            iconUrl: quote.iconUrl ?? null,
            decimals: msolBalance.decimals,
            priceUsd: quote.priceUsd ?? null,
            priceChange24h: quote.priceChange24h ?? null,
            usdValue,
          }),
        ],
        usdValue,
        raw: {
          mint: MSOL_MINT,
          amount: String(msolBalance.amount),
          unit_price_usd: quote.priceUsd ?? null,
          price_change_24h: quote.priceChange24h ?? null,
          icon_url: quote.iconUrl ?? null,
          display_name: quote.name ?? "Marinade Staked SOL",
          display_symbol: quote.symbol ?? "mSOL",
        },
      }),
    ];
  }
}

export class MarinadeNativeStakeAdapter {
  constructor(chainProvider, priceProvider) {
    this.protocolName = "marinade_native";
    this.chainProvider = chainProvider;
    this.priceProvider = priceProvider;
  }

  async collectPositions(walletAddress) {
    const stakeAccounts = await this.chainProvider.getMarinadeNativeStakeAccounts(
      walletAddress,
      MARINADE_NATIVE_STAKER_AUTHORITY,
    );
    const activeAccounts = stakeAccounts.filter((account) => account.active_sol > 0);
    if (activeAccounts.length === 0) {
      return [];
    }

    const totalSol = activeAccounts.reduce((total, account) => total + account.active_sol, 0);
    const quote = (await this.priceProvider.getQuote(SOL_MINT)) ?? {};
    const usdValue = totalSol * safeNumber(quote.priceUsd);
    return [
      createPosition({
        walletAddress,
        protocol: this.protocolName,
        positionType: "staking",
        positionKey: `${walletAddress}:marinade_native:aggregate`,
        quantity: [
          quantityComponent({
            mint: SOL_MINT,
            symbol: quote.symbol ?? "SOL",
            name: "Marinade Native",
            amount: totalSol,
            iconUrl: quote.iconUrl ?? null,
            decimals: 9,
            priceUsd: quote.priceUsd ?? null,
            priceChange24h: quote.priceChange24h ?? null,
            usdValue,
          }),
        ],
        usdValue,
        raw: {
          mint: SOL_MINT,
          amount: String(totalSol),
          unit_price_usd: quote.priceUsd ?? null,
          price_change_24h: quote.priceChange24h ?? null,
          display_name: "Marinade Native",
          display_symbol: "mNative",
          native_stake_accounts: activeAccounts,
          active_account_count: activeAccounts.length,
        },
      }),
    ];
  }
}

export class RaydiumLpAdapter {
  constructor(chainProvider, priceProvider) {
    this.protocolName = "raydium";
    this.chainProvider = chainProvider;
    this.priceProvider = priceProvider;
    this.connection = new Connection(chainProvider.rpcUrl, "confirmed");
  }

  async collectPositions(walletAddress) {
    const owner = new PublicKey(walletAddress);
    const raydium = await withRetry(
      () => Raydium.load({ connection: this.connection, owner, disableLoadToken: true, blockhashCommitment: "confirmed" }),
      { attempts: 3, baseDelayMs: 600 },
    );
    const ownerPositions = await withRetry(() => raydium.clmm.getOwnerPositionInfo({}), {
      attempts: 3,
      baseDelayMs: 700,
    });

    if (ownerPositions.length === 0) {
      return [];
    }

    const poolIds = [...new Set(ownerPositions.map((position) => position.poolId.toBase58()))];
    const poolInfoList = await withRetry(() => raydium.api.fetchPoolById({ ids: poolIds.join(",") }), {
      attempts: 3,
      baseDelayMs: 700,
    });
    const poolKeyList = await withRetry(() => raydium.api.fetchPoolKeysById({ idList: poolIds }), {
      attempts: 3,
      baseDelayMs: 700,
    });
    const poolInfoById = Object.fromEntries(poolInfoList.map((pool) => [pool.id, pool]));
    const poolKeysById = Object.fromEntries(poolKeyList.map((pool) => [pool.id, pool]));
    const epochInfo = await withRetry(() => this.connection.getEpochInfo("confirmed"), { attempts: 3, baseDelayMs: 500 });

    const positions = [];
    for (const ownerPosition of ownerPositions) {
      const poolInfo = poolInfoById[ownerPosition.poolId.toBase58()];
      const poolKeys = poolKeysById[ownerPosition.poolId.toBase58()];
      if (!poolInfo) {
        continue;
      }

      const amounts = PositionUtils.getAmountsFromLiquidity({
        poolInfo,
        ownerPosition,
        liquidity: ownerPosition.liquidity,
        slippage: 0,
        add: false,
        epochInfo,
      });

      const quoteA = (await this.priceProvider.getQuote(poolInfo.mintA.address)) ?? {};
      const quoteB = (await this.priceProvider.getQuote(poolInfo.mintB.address)) ?? {};
      const amountA = safeNumber(amounts.amountA.amount?.toString()) / 10 ** poolInfo.mintA.decimals;
      const amountB = safeNumber(amounts.amountB.amount?.toString()) / 10 ** poolInfo.mintB.decimals;
      const usdValue = amountA * safeNumber(quoteA.priceUsd) + amountB * safeNumber(quoteB.priceUsd);
      const feeComponents = [
        quantityComponent({
          mint: poolInfo.mintA.address,
          symbol: quoteA.symbol ?? poolInfo.mintA.symbol?.trim() ?? poolInfo.mintA.address.slice(0, 4),
          name: quoteA.name ?? poolInfo.mintA.name?.trim() ?? poolInfo.mintA.symbol?.trim() ?? poolInfo.mintA.address,
          amount: decimalAmount(ownerPosition.tokenFeesOwedA, poolInfo.mintA.decimals),
          iconUrl: quoteA.iconUrl ?? poolInfo.mintA.logoURI ?? null,
          decimals: poolInfo.mintA.decimals,
          priceUsd: quoteA.priceUsd ?? null,
          usdValue: decimalAmount(ownerPosition.tokenFeesOwedA, poolInfo.mintA.decimals) * safeNumber(quoteA.priceUsd),
        }),
        quantityComponent({
          mint: poolInfo.mintB.address,
          symbol: quoteB.symbol ?? poolInfo.mintB.symbol?.trim() ?? poolInfo.mintB.address.slice(0, 4),
          name: quoteB.name ?? poolInfo.mintB.name?.trim() ?? poolInfo.mintB.symbol?.trim() ?? poolInfo.mintB.address,
          amount: decimalAmount(ownerPosition.tokenFeesOwedB, poolInfo.mintB.decimals),
          iconUrl: quoteB.iconUrl ?? poolInfo.mintB.logoURI ?? null,
          decimals: poolInfo.mintB.decimals,
          priceUsd: quoteB.priceUsd ?? null,
          usdValue: decimalAmount(ownerPosition.tokenFeesOwedB, poolInfo.mintB.decimals) * safeNumber(quoteB.priceUsd),
        }),
      ].filter((item) => item.amount > 0);
      const feesUsd = feeComponents.reduce((total, item) => total + safeNumber(item.usd_value), 0);

      const rewardComponents = [];
      for (const [index, rewardInfo] of (ownerPosition.rewardInfos ?? []).entries()) {
        const rewardMintInfo = poolKeys?.rewardInfos?.[index]?.mint ?? poolInfo.rewardDefaultInfos?.[index]?.mint;
        if (!rewardMintInfo) {
          continue;
        }

        const rewardMintAddress = rewardMintInfo.address ?? rewardMintInfo.mint ?? null;
        if (!rewardMintAddress) {
          continue;
        }

        const rewardQuote = (await this.priceProvider.getQuote(rewardMintAddress)) ?? {};
        const rewardDecimals = Number(rewardMintInfo.decimals ?? tokenMetadataForMint(rewardMintAddress)?.decimals ?? 0);
        const rewardAmount = decimalAmount(rewardInfo.rewardAmountOwed, rewardDecimals);
        if (rewardAmount <= 0) {
          continue;
        }

        rewardComponents.push(
          quantityComponent({
            mint: rewardMintAddress,
            symbol: rewardQuote.symbol ?? rewardMintInfo.symbol?.trim() ?? rewardMintAddress.slice(0, 4),
            name: rewardQuote.name ?? rewardMintInfo.name?.trim() ?? rewardMintInfo.symbol?.trim() ?? rewardMintAddress,
            amount: rewardAmount,
            iconUrl: rewardQuote.iconUrl ?? rewardMintInfo.logoURI ?? null,
            decimals: rewardDecimals,
            priceUsd: rewardQuote.priceUsd ?? null,
            usdValue: rewardAmount * safeNumber(rewardQuote.priceUsd),
          }),
        );
      }
      const incentiveRewardsUsd = rewardComponents.reduce((total, item) => total + safeNumber(item.usd_value), 0);
      const rewardsUsd = feesUsd + incentiveRewardsUsd;

      const quantity = [
        quantityComponent({
          mint: poolInfo.mintA.address,
          symbol: quoteA.symbol ?? poolInfo.mintA.symbol?.trim() ?? poolInfo.mintA.address.slice(0, 4),
          name: quoteA.name ?? poolInfo.mintA.name?.trim() ?? poolInfo.mintA.symbol?.trim() ?? poolInfo.mintA.address,
          amount: amountA,
          iconUrl: quoteA.iconUrl ?? poolInfo.mintA.logoURI ?? null,
          decimals: poolInfo.mintA.decimals,
          priceUsd: quoteA.priceUsd ?? null,
          priceChange24h: quoteA.priceChange24h ?? null,
          usdValue: amountA * safeNumber(quoteA.priceUsd),
        }),
        quantityComponent({
          mint: poolInfo.mintB.address,
          symbol: quoteB.symbol ?? poolInfo.mintB.symbol?.trim() ?? poolInfo.mintB.address.slice(0, 4),
          name: quoteB.name ?? poolInfo.mintB.name?.trim() ?? poolInfo.mintB.symbol?.trim() ?? poolInfo.mintB.address,
          amount: amountB,
          iconUrl: quoteB.iconUrl ?? poolInfo.mintB.logoURI ?? null,
          decimals: poolInfo.mintB.decimals,
          priceUsd: quoteB.priceUsd ?? null,
          priceChange24h: quoteB.priceChange24h ?? null,
          usdValue: amountB * safeNumber(quoteB.priceUsd),
        }),
      ];

      positions.push(
        createPosition({
          walletAddress,
          protocol: this.protocolName,
          positionType: "lp",
          positionKey: `${walletAddress}:raydium:clmm:${ownerPosition.nftMint.toBase58()}`,
          quantity,
          usdValue,
          rewardsUsd,
          raw: {
            display_name: `${quantity[0].symbol} / ${quantity[1].symbol}`,
            display_symbol: "CLMM",
            pool_id: poolInfo.id,
            pool_name: poolInfo.name ?? `${quantity[0].symbol}/${quantity[1].symbol}`,
            pool_type: poolInfo.type ?? "Concentrated",
            position_nft_mint: ownerPosition.nftMint.toBase58(),
            liquidity: ownerPosition.liquidity.toString(),
            tick_lower: ownerPosition.tickLower,
            tick_upper: ownerPosition.tickUpper,
            fee_apr_24h: safeNumber(poolInfo.day?.feeApr ?? 0),
            tvl_usd: safeNumber(poolInfo.tvl),
            pair_address: poolInfo.id,
            fees_usd: feesUsd,
            fees: feeComponents,
            incentive_rewards_usd: incentiveRewardsUsd,
            incentive_rewards: rewardComponents,
            unclaimed_usd: rewardsUsd,
          },
        }),
      );
    }

    return positions.sort((left, right) => right.usd_value - left.usd_value);
  }
}

export class LpTokenAdapter {
  constructor(chainProvider, priceProvider) {
    this.protocolName = "lp_tokens";
    this.chainProvider = chainProvider;
    this.priceProvider = priceProvider;
  }

  async collectPositions(walletAddress) {
    const positions = [];
    const balances = await this.chainProvider.getTokenBalances(walletAddress);

    for (const balance of balances) {
      const lpName = KNOWN_LP_MINTS[balance.mint];
      if (!lpName) {
        continue;
      }

      const quote = await this.priceProvider.getQuote(balance.mint);
      const usdValue = balance.amount * safeNumber(quote?.priceUsd);
      positions.push(
        createPosition({
          walletAddress,
          protocol: this.protocolName,
          positionType: "lp",
          positionKey: `${walletAddress}:lp:${balance.mint}`,
          quantity: [
            quantityComponent({
              mint: balance.mint,
              symbol: lpName,
              name: lpName,
              amount: balance.amount,
              decimals: balance.decimals,
              priceUsd: quote?.priceUsd ?? null,
              usdValue,
            }),
          ],
          usdValue,
          raw: {
            mint: balance.mint,
            amount: String(balance.amount),
            display_name: lpName,
            display_symbol: lpName,
            unit_price_usd: quote?.priceUsd ?? null,
          },
        }),
      );
    }

    return positions;
  }
}
