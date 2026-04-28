import { PublicKey } from "@solana/web3.js";
import { PositionUtils, Raydium } from "@raydium-io/raydium-sdk-v2";
import { describe, expect, it, vi } from "vitest";

import {
  LpTokenAdapter,
  MarinadeAdapter,
  MarinadeNativeStakeAdapter,
  RaydiumLpAdapter,
  WalletTokenAdapter,
} from "../src/backend/adapters.js";
import { MSOL_MINT, PUMP_MINT, SOL_MINT, URMOM_MINT } from "../src/backend/config.js";
import { FallbackPriceProvider, SolanaRpcProvider, StaticPriceProvider } from "../src/backend/providers.js";

class FakeChainProvider {
  constructor() {
    this.rpcUrl = "https://rpc.example";
  }

  async getSolBalance() {
    return 1.5;
  }

  async getTokenBalances() {
    return [
      { mint: MSOL_MINT, amount: 2.25, decimals: 9, symbol: "mSOL", name: "Marinade Staked SOL" },
      { mint: URMOM_MINT, amount: 20_000_000, decimals: 6, symbol: "URMOM", name: "URMOM" },
      { mint: "TokenMint123", amount: 5, decimals: 6, symbol: "TKX", name: "Token X" },
    ];
  }

  async getMarinadeNativeStakeAccounts(walletAddress) {
    if (walletAddress !== "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS") {
      return [];
    }

    return [
      {
        address: "stakeAcct1",
        active_sol: 1.5,
        voter: "vote111111111111111111111111111111111111111",
      },
    ];
  }
}

class FakePriceProvider {
  async getQuote(mint) {
    return {
      [SOL_MINT]: { mint, priceUsd: 100, symbol: "SOL", name: "Solana", priceChange24h: -4.2 },
      [MSOL_MINT]: { mint, priceUsd: 120, symbol: "mSOL", name: "Marinade Staked SOL", priceChange24h: -3.8 },
      [PUMP_MINT]: { mint, priceUsd: 0.00184, symbol: "PUMP", name: "Pump", priceChange24h: 4.2 },
      [URMOM_MINT]: { mint, priceUsd: 0.000165, symbol: "URMOM", name: "URMOM", priceChange24h: -0.61 },
      RewardMint123: { mint, priceUsd: 2, symbol: "RWD", name: "Reward Token", priceChange24h: 4.2 },
      TokenMint123: { mint, priceUsd: 2, symbol: "TKX", name: "Token X", priceChange24h: 1.5 },
    }[mint] ?? null;
  }
}

describe("providers and adapters", () => {
  it("falls back to the next provider after an error", async () => {
    const provider = new FallbackPriceProvider([
      {
        async getQuote() {
          throw new Error("boom");
        },
      },
      new StaticPriceProvider({ mint1: 42 }),
    ]);

    await expect(provider.getPriceUsd("mint1")).resolves.toBe(42);
  });

  it("retries rpc calls after a 429 response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Too Many Requests", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ result: { value: 1_000_000_000 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const provider = new SolanaRpcProvider("https://rpc.example", { fetchImpl: fetchMock });
    await expect(provider.getSolBalance("3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R")).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads balances from both SPL Token and Token-2022 programs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              value: [
                {
                  pubkey: "legacy-token-account",
                  account: {
                    data: {
                      parsed: {
                        info: {
                          mint: URMOM_MINT,
                          state: "initialized",
                          tokenAmount: { uiAmountString: "12.5", decimals: 6 },
                        },
                      },
                    },
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              value: [
                {
                  pubkey: "token-2022-account",
                  account: {
                    data: {
                      parsed: {
                        info: {
                          mint: PUMP_MINT,
                          state: "initialized",
                          tokenAmount: { uiAmountString: "270407.354066", decimals: 6 },
                        },
                      },
                    },
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const provider = new SolanaRpcProvider("https://rpc.example", { fetchImpl: fetchMock });
    const balances = await provider.getTokenBalances("3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R");

    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mint: URMOM_MINT, amount: 12.5 }),
        expect.objectContaining({ mint: PUMP_MINT, amount: 270407.354066, symbol: "PUMP" }),
      ]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps Token-2022 balances when the legacy token scan is rate-limited", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Too Many Requests", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              value: [
                {
                  pubkey: "token-2022-account",
                  account: {
                    data: {
                      parsed: {
                        info: {
                          mint: PUMP_MINT,
                          state: "initialized",
                          tokenAmount: { uiAmountString: "602011.912025", decimals: 6 },
                        },
                      },
                    },
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const provider = new SolanaRpcProvider("https://rpc.example", { fetchImpl: fetchMock });
    const balances = await provider.getTokenBalances("CRsHntQirTYe9zwZYYMJpt6Wm6TaZyncUYF4TgW39zcf");

    expect(balances).toEqual([expect.objectContaining({ mint: PUMP_MINT, amount: 602011.912025 })]);
  });

  it("falls back to tracked-token lookups when the full token scan fails", async () => {
    const chainProvider = {
      async getSolBalance() {
        return 1.5;
      },
      async getTokenBalances() {
        throw new Error("rate limited");
      },
      async getTrackedTokenBalances() {
        return [{ mint: PUMP_MINT, amount: 270407.354066, decimals: 6, symbol: "PUMP", name: "Pump" }];
      },
    };

    const walletPositions = await new WalletTokenAdapter(chainProvider, new FakePriceProvider()).collectPositions("wallet");

    expect(walletPositions.find((position) => position.raw.display_symbol === "PUMP")?.usd_value).toBeCloseTo(497.5495, 4);
    expect(walletPositions).toHaveLength(2);
  });

  it("keeps prefetched tracked tokens when the broader token scan is rate-limited", async () => {
    const callOrder = [];
    const chainProvider = {
      async getSolBalance() {
        return 1.5;
      },
      async getTrackedTokenBalances() {
        callOrder.push("tracked");
        return [{ mint: PUMP_MINT, amount: 602011.912025, decimals: 6, symbol: "PUMP", name: "Pump" }];
      },
      async getTokenBalances() {
        callOrder.push("scan");
        throw new Error("rate limited");
      },
    };

    const walletPositions = await new WalletTokenAdapter(chainProvider, new FakePriceProvider()).collectPositions("wallet");

    expect(callOrder.slice(0, 2)).toEqual(["tracked", "scan"]);
    expect(walletPositions.find((position) => position.raw.display_symbol === "PUMP")?.usd_value).toBeCloseTo(1107.7019, 4);
  });

  it("backfills tracked tokens that are missing from a partial wallet scan", async () => {
    const chainProvider = {
      async getSolBalance() {
        return 1.5;
      },
      async getTokenBalances() {
        return [{ mint: URMOM_MINT, amount: 12.5, decimals: 6, symbol: "URMOM", name: "URMOM" }];
      },
      async getTrackedTokenBalances(_walletAddress, mints) {
        expect(mints).toContain(PUMP_MINT);
        return [{ mint: PUMP_MINT, amount: 602011.912025, decimals: 6, symbol: "PUMP", name: "Pump" }];
      },
    };

    const walletPositions = await new WalletTokenAdapter(chainProvider, new FakePriceProvider()).collectPositions("wallet");

    expect(walletPositions.find((position) => position.raw.display_symbol === "PUMP")?.usd_value).toBeCloseTo(1107.7019, 4);
    expect(walletPositions.find((position) => position.raw.display_symbol === "URMOM")?.usd_value).toBeCloseTo(0.0020625, 7);
  });

  it("returns expected positions for wallet, marinade, native stake, raydium, and lp adapters", async () => {
    const chainProvider = new FakeChainProvider();
    const priceProvider = new FakePriceProvider();

    const poolId = new PublicKey("J2RwRUiUafbvJdfNMgEELY4h27gmQtV1YGwDUhez68yu");
    const nftMint = new PublicKey("5rs98PFHcud13vxcuqFy3h4t3Y3QzV3VxvyYQX15qyLq");
    const raydiumLoadSpy = vi.spyOn(Raydium, "load").mockResolvedValue({
      clmm: {
        getOwnerPositionInfo: vi.fn().mockResolvedValue([
          {
            poolId,
            nftMint,
            liquidity: { toString: () => "123456789" },
            tickLower: -120,
            tickUpper: 80,
            tokenFeesOwedA: { toString: () => "100000000" },
            tokenFeesOwedB: { toString: () => "600000000" },
            rewardInfos: [{ rewardAmountOwed: { toString: () => "3000000" } }],
          },
        ]),
      },
      api: {
        fetchPoolById: vi.fn().mockResolvedValue([
          {
            id: poolId.toBase58(),
            name: "URMOM / SOL",
            type: "Concentrated",
            mintA: {
              address: SOL_MINT,
              symbol: "SOL",
              name: "Solana",
              decimals: 9,
              logoURI: null,
            },
            mintB: {
              address: URMOM_MINT,
              symbol: "URMOM",
              name: "URMOM",
              decimals: 6,
              logoURI: null,
            },
            day: { feeApr: 6.5 },
            rewardDefaultInfos: [],
            tvl: 4180,
          },
        ]),
        fetchPoolKeysById: vi.fn().mockResolvedValue([
          {
            id: poolId.toBase58(),
            rewardInfos: [
              {
                mint: {
                  address: "RewardMint123",
                  symbol: "RWD",
                  name: "Reward Token",
                  decimals: 6,
                  logoURI: null,
                },
              },
            ],
          },
        ]),
      },
    });
    const amountsSpy = vi.spyOn(PositionUtils, "getAmountsFromLiquidity").mockReturnValue({
      amountA: { amount: { toString: () => "2000000000" } },
      amountB: { amount: { toString: () => "12000000000" } },
    });

    const walletPositions = await new WalletTokenAdapter(chainProvider, priceProvider).collectPositions("wallet");
    const marinadePositions = await new MarinadeAdapter(chainProvider, priceProvider).collectPositions("wallet");
    const nativePositions = await new MarinadeNativeStakeAdapter(chainProvider, priceProvider).collectPositions(
      "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
    );
    const raydiumAdapter = new RaydiumLpAdapter(chainProvider, priceProvider);
    raydiumAdapter.connection = { getEpochInfo: vi.fn().mockResolvedValue({ epoch: 123 }) };
    const raydiumPositions = await raydiumAdapter.collectPositions("ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS");
    const lpPositions = await new LpTokenAdapter(chainProvider, priceProvider).collectPositions("wallet");

    expect(walletPositions).toHaveLength(3);
    expect(walletPositions.find((position) => position.raw.display_symbol === "URMOM")?.usd_value).toBe(3300);
    expect(walletPositions.reduce((total, position) => total + position.usd_value, 0)).toBe(3460);
    expect(marinadePositions[0].usd_value).toBe(270);
    expect(nativePositions[0].usd_value).toBe(150);
    expect(raydiumPositions).toHaveLength(1);
    expect(raydiumPositions[0].protocol).toBe("raydium");
    expect(raydiumPositions[0].raw.pool_type).toBe("Concentrated");
    expect(raydiumPositions[0].usd_value).toBeCloseTo(201.98, 2);
    expect(raydiumPositions[0].rewards_usd).toBeCloseTo(16.1, 1);
    expect(raydiumPositions[0].raw.fees_usd).toBeCloseTo(10.1, 1);
    expect(raydiumPositions[0].raw.incentive_rewards_usd).toBe(6);
    expect(lpPositions).toHaveLength(0);

    expect(raydiumLoadSpy).toHaveBeenCalledTimes(1);
    expect(amountsSpy).toHaveBeenCalledTimes(1);
  });
});
