import { SCOPES, TRACKED_WALLETS, defaultRpcUrl } from "./config.js";
import {
  finishIngestionRun,
  insertPositionSnapshot,
  savePortfolioSnapshot,
  startIngestionRun,
  summarizeScope,
  upsertCurrentPosition,
  upsertPrice,
} from "./db.js";
import { LpTokenAdapter, MarinadeAdapter, MarinadeNativeStakeAdapter, RaydiumLpAdapter, WalletTokenAdapter } from "./adapters.js";
import {
  CoinGeckoPriceProvider,
  DexScreenerPriceProvider,
  FallbackPriceProvider,
  SolanaRpcProvider,
  StaticPriceProvider,
} from "./providers.js";
import { utcNowIso } from "./utils.js";

export async function runIngestion(db, options = {}) {
  const rpcUrl = options.rpcUrl ?? defaultRpcUrl();
  const chainProvider = options.chainProvider ?? new SolanaRpcProvider(rpcUrl);
  const priceProvider =
    options.priceProvider ??
    new FallbackPriceProvider([new CoinGeckoPriceProvider(), new DexScreenerPriceProvider(), new StaticPriceProvider()]);

  const adapters = [
    new WalletTokenAdapter(chainProvider, priceProvider),
    new MarinadeAdapter(chainProvider, priceProvider),
    new MarinadeNativeStakeAdapter(chainProvider, priceProvider),
    new RaydiumLpAdapter(chainProvider, priceProvider),
    new LpTokenAdapter(chainProvider, priceProvider),
  ];

  const runId = startIngestionRun(db);
  const snapshotTs = utcNowIso();
  const errorMessages = [];
  let errors = 0;
  let positionsWritten = 0;

  for (const wallet of TRACKED_WALLETS) {
    for (const adapter of adapters) {
      try {
        const positions = await adapter.collectPositions(wallet.address);
        for (const position of positions) {
          upsertCurrentPosition(db, position);
          insertPositionSnapshot(db, position, snapshotTs);

          for (const quantity of position.quantity) {
            const price = quantity.price_usd ?? (await priceProvider.getPriceUsd(quantity.mint));
            if (price !== null && price !== undefined) {
              upsertPrice(db, quantity.mint, Number(price), "provider_chain", null);
            }
          }

          positionsWritten += 1;
        }
      } catch (error) {
        errors += 1;
        errorMessages.push(`wallet=${wallet.scope} adapter=${adapter.protocolName} error=${error.message}`);
      }
    }
  }

  for (const scope of SCOPES) {
    const summary = summarizeScope(db, scope);
    summary.snapshot_ts = snapshotTs;
    savePortfolioSnapshot(db, summary);
  }

  const status = errors === 0 ? "success" : "partial_success";
  const notes = `positions_written=${positionsWritten}; errors=${errors}; details=${errorMessages.join(" | ")}`;
  finishIngestionRun(db, runId, status, errors, notes);

  return {
    positionsWritten,
    errors,
    errorMessages,
    status,
  };
}
