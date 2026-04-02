import {
  KNOWN_LP_MINTS,
  MARINADE_NATIVE_STAKE_ACCOUNTS,
  MARINADE_VALIDATOR_VOTE_ACCOUNTS,
  MSOL_MINT,
  RAYDIUM_LP_MINTS,
  SOL_MINT,
  TOKEN_SYMBOL_OVERRIDES,
} from "./config.js";
import { utcNowIso } from "./utils.js";

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
  return {
    wallet_address: walletAddress,
    protocol,
    position_type: positionType,
    position_key: positionKey,
    quantity,
    usd_value: usdValue,
    rewards_usd: rewardsUsd,
    pnl_usd: pnlUsd,
    raw,
    updated_at: utcNowIso(),
  };
}

function quantityComponent(mint, symbol, amount) {
  return { mint, symbol, amount };
}

export class WalletTokenAdapter {
  constructor(chainProvider, priceProvider) {
    this.protocolName = "wallet_tokens";
    this.chainProvider = chainProvider;
    this.priceProvider = priceProvider;
  }

  async collectPositions(walletAddress) {
    const positions = [];

    const solAmount = await this.chainProvider.getSolBalance(walletAddress);
    const solPrice = (await this.priceProvider.getPriceUsd(SOL_MINT)) ?? 0;
    positions.push(
      createPosition({
        walletAddress,
        protocol: this.protocolName,
        positionType: "wallet_balance",
        positionKey: `${walletAddress}:native:${SOL_MINT}`,
        quantity: [quantityComponent(SOL_MINT, TOKEN_SYMBOL_OVERRIDES[SOL_MINT] ?? "SOL", solAmount)],
        usdValue: solAmount * solPrice,
        raw: { amount: String(solAmount), mint: SOL_MINT },
      }),
    );

    const tokenBalances = await this.chainProvider.getTokenBalances(walletAddress);
    for (const token of tokenBalances) {
      const symbol = token.symbol ?? TOKEN_SYMBOL_OVERRIDES[token.mint] ?? token.mint.slice(0, 4);
      const price = (await this.priceProvider.getPriceUsd(token.mint)) ?? 0;
      positions.push(
        createPosition({
          walletAddress,
          protocol: this.protocolName,
          positionType: "wallet_balance",
          positionKey: `${walletAddress}:token:${token.mint}`,
          quantity: [quantityComponent(token.mint, symbol, token.amount)],
          usdValue: token.amount * price,
          raw: { amount: String(token.amount), mint: token.mint, decimals: token.decimals },
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

    const price = (await this.priceProvider.getPriceUsd(MSOL_MINT)) ?? 0;
    return [
      createPosition({
        walletAddress,
        protocol: this.protocolName,
        positionType: "staking",
        positionKey: `${walletAddress}:marinade:${MSOL_MINT}`,
        quantity: [quantityComponent(MSOL_MINT, TOKEN_SYMBOL_OVERRIDES[MSOL_MINT] ?? "mSOL", msolBalance.amount)],
        usdValue: msolBalance.amount * price,
        raw: {
          note: "Derived from wallet mSOL balance; extend with Marinade stake-account parsing",
          amount: String(msolBalance.amount),
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

  async discoverStakeAccountsFromHistory(walletAddress) {
    const signatures = await this.chainProvider.getSignaturesForAddress(walletAddress, 200);
    const discovered = new Set();

    for (const signature of signatures) {
      const transaction = await this.chainProvider.getParsedTransaction(signature);
      const instructions = transaction?.transaction?.message?.instructions ?? [];
      for (const instruction of instructions) {
        const program = instruction.program;
        const info = instruction?.parsed?.info ?? {};
        if (program !== "stake") {
          continue;
        }

        const stakeAccount = info.stakeAccount ?? info.newSplitAccount;
        if (stakeAccount) {
          discovered.add(stakeAccount);
        }
      }
    }

    return discovered;
  }

  async collectPositions(walletAddress) {
    const configured = new Set(MARINADE_NATIVE_STAKE_ACCOUNTS[walletAddress] ?? []);
    const discovered = await this.discoverStakeAccountsFromHistory(walletAddress);
    const stakeAccounts = [...new Set([...configured, ...discovered])].sort();
    if (stakeAccounts.length === 0) {
      return [];
    }

    const accounts = await this.chainProvider.getParsedMultipleAccounts(stakeAccounts);
    let totalSol = 0;
    const details = [];

    for (const row of accounts) {
      const address = row.address;
      const stakeInfo = row?.account?.data?.parsed?.info?.stake?.delegation ?? {};
      const voter = stakeInfo.voter ?? "";
      if (MARINADE_VALIDATOR_VOTE_ACCOUNTS.size > 0 && !MARINADE_VALIDATOR_VOTE_ACCOUNTS.has(voter)) {
        continue;
      }

      const activeSol = Number(stakeInfo.stake ?? 0) / 1_000_000_000;
      totalSol += activeSol;
      details.push({ stake_account: address, voter, active_sol: activeSol });
    }

    if (totalSol === 0) {
      return [];
    }

    const price = (await this.priceProvider.getPriceUsd(SOL_MINT)) ?? 0;
    return [
      createPosition({
        walletAddress,
        protocol: this.protocolName,
        positionType: "staking",
        positionKey: `${walletAddress}:marinade_native:aggregate`,
        quantity: [quantityComponent(SOL_MINT, TOKEN_SYMBOL_OVERRIDES[SOL_MINT] ?? "SOL", totalSol)],
        usdValue: totalSol * price,
        raw: {
          native_stake_accounts: details,
          configured_accounts: [...configured].sort(),
          discovered_accounts: [...discovered].sort(),
          note: "Native stake accounts are auto-discovered from wallet stake instructions and merged with configured list",
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
  }

  async collectPositions(walletAddress) {
    const balances = await this.chainProvider.getTokenBalances(walletAddress);
    const positions = [];

    for (const balance of balances) {
      const lpName = RAYDIUM_LP_MINTS[balance.mint];
      if (!lpName) {
        continue;
      }

      const price = (await this.priceProvider.getPriceUsd(balance.mint)) ?? 0;
      positions.push(
        createPosition({
          walletAddress,
          protocol: this.protocolName,
          positionType: "lp",
          positionKey: `${walletAddress}:raydium:${balance.mint}`,
          quantity: [quantityComponent(balance.mint, lpName, balance.amount)],
          usdValue: balance.amount * price,
          raw: {
            mint: balance.mint,
            lp_name: lpName,
            amount: String(balance.amount),
            source: "raydium_mint_allowlist",
          },
        }),
      );
    }

    return positions;
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

      const price = (await this.priceProvider.getPriceUsd(balance.mint)) ?? 0;
      positions.push(
        createPosition({
          walletAddress,
          protocol: this.protocolName,
          positionType: "lp",
          positionKey: `${walletAddress}:lp:${balance.mint}`,
          quantity: [quantityComponent(balance.mint, lpName, balance.amount)],
          usdValue: balance.amount * price,
          raw: {
            lp_name: lpName,
            mint: balance.mint,
            amount: String(balance.amount),
            note: "LP token detected from configured mint allowlist",
          },
        }),
      );
    }

    return positions;
  }
}
