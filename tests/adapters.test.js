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
import { MSOL_MINT, SOL_MINT, URMOM_MINT } from "../src/backend/config.js";
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
      [URMOM_MINT]: { mint, priceUsd: 0.000165, symbol: "URMOM", name: "URMOM", priceChange24h: -0.61 },
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
            tvl: 4180,
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
    expect(raydiumPositions[0].rewards_usd).toBeCloseTo(10.1, 1);
    expect(lpPositions).toHaveLength(0);

    expect(raydiumLoadSpy).toHaveBeenCalledTimes(1);
    expect(amountsSpy).toHaveBeenCalledTimes(1);
  });
});
