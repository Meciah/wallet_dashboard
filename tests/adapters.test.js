import { describe, expect, it, vi } from "vitest";

import {
  LpTokenAdapter,
  MarinadeAdapter,
  MarinadeNativeStakeAdapter,
  RaydiumLpAdapter,
  WalletTokenAdapter,
} from "../src/backend/adapters.js";
import { RAYDIUM_LP_MINTS, SOL_MINT } from "../src/backend/config.js";
import { FallbackPriceProvider, SolanaRpcProvider, StaticPriceProvider } from "../src/backend/providers.js";

class FakeChainProvider {
  async getSolBalance() {
    return 1.5;
  }

  async getTokenBalances() {
    const rayMint = Object.keys(RAYDIUM_LP_MINTS)[0];
    return [
      { mint: "mSoLzYCxHdYgdzUevW6Y8k9sW5M2YfLQ7fPjYq4Jp7", amount: 2.25, decimals: 9, symbol: null },
      { mint: "TokenMint123", amount: 5, decimals: 6, symbol: "TKX" },
      { mint: rayMint, amount: 2, decimals: 6, symbol: null },
      { mint: "LPPlaceholderMint11111111111111111111111111111111", amount: 3.5, decimals: 9, symbol: null },
    ];
  }

  async getParsedMultipleAccounts(addresses) {
    return [
      {
        address: addresses[0],
        account: {
          data: {
            parsed: {
              info: {
                stake: {
                  delegation: {
                    stake: "1500000000",
                    voter: "",
                  },
                },
              },
            },
          },
        },
      },
    ];
  }

  async getSignaturesForAddress() {
    return ["sig1"];
  }

  async getParsedTransaction() {
    return {
      transaction: {
        message: {
          instructions: [
            {
              program: "stake",
              parsed: {
                info: {
                  stakeAccount: "stakeAcct1",
                },
              },
            },
          ],
        },
      },
    };
  }
}

class FakePriceProvider {
  async getPriceUsd(mint) {
    const rayMint = Object.keys(RAYDIUM_LP_MINTS)[0];
    return {
      [SOL_MINT]: 100,
      mSoLzYCxHdYgdzUevW6Y8k9sW5M2YfLQ7fPjYq4Jp7: 120,
      TokenMint123: 2,
      [rayMint]: 10,
      LPPlaceholderMint11111111111111111111111111111111: 4,
    }[mint];
  }
}

describe("providers and adapters", () => {
  it("falls back to the next provider after an error", async () => {
    const provider = new FallbackPriceProvider([
      { async getPriceUsd() { throw new Error("boom"); } },
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

    const walletPositions = await new WalletTokenAdapter(chainProvider, priceProvider).collectPositions("wallet");
    const marinadePositions = await new MarinadeAdapter(chainProvider, priceProvider).collectPositions("wallet");
    const nativePositions = await new MarinadeNativeStakeAdapter(chainProvider, priceProvider).collectPositions(
      "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
    );
    const raydiumPositions = await new RaydiumLpAdapter(chainProvider, priceProvider).collectPositions("wallet");
    const lpPositions = await new LpTokenAdapter(chainProvider, priceProvider).collectPositions("wallet");

    expect(walletPositions).toHaveLength(5);
    expect(walletPositions.reduce((total, position) => total + position.usd_value, 0)).toBe(464);
    expect(marinadePositions[0].usd_value).toBe(270);
    expect(nativePositions[0].usd_value).toBe(150);
    expect(raydiumPositions[0].protocol).toBe("raydium");
    expect(lpPositions[0].usd_value).toBe(14);
  });
});
