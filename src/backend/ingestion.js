import { HISTORY_SERIES, SCOPES, TRACKED_TOKENS, TRACKED_WALLETS, defaultRpcUrl } from "./config.js";
import {
  finishIngestionRun,
  insertPositionSnapshot,
  savePortfolioSnapshotSeries,
  startIngestionRun,
  summarizeHistoryScope,
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

export async function syncTrackedTokenPrices(db, priceProvider) {
  const errorMessages = [];

  for (const token of TRACKED_TOKENS) {
    try {
      const quote = await priceProvider.getQuote(token.mint);
      const price = quote?.priceUsd ?? null;
      if (price !== null) {
        upsertPrice(db, token.mint, Number(price), "provider_chain", null);
      }
    } catch (error) {
      errorMessages.push(`tracked_token=${token.symbol} error=${error.message}`);
    }
  }

  return errorMessages;
}

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

  for (const adapter of adapters) {
    for (const wallet of TRACKED_WALLETS) {
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

  const trackedTokenErrors = await syncTrackedTokenPrices(db, priceProvider);
  errors += trackedTokenErrors.length;
  errorMessages.push(...trackedTokenErrors);

  for (const scope of SCOPES) {
    const coreSummary = summarizeHistoryScope(db, scope);
    coreSummary.snapshot_ts = snapshotTs;
    savePortfolioSnapshotSeries(db, coreSummary, HISTORY_SERIES.CORE);

    const summaryWithLiquidity = summarizeScope(db, scope);
    summaryWithLiquidity.snapshot_ts = snapshotTs;
    savePortfolioSnapshotSeries(db, summaryWithLiquidity, HISTORY_SERIES.WITH_LIQUIDITY);
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
