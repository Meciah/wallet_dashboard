import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const DATA_BASE = `${import.meta.env.BASE_URL}data`;
const HISTORY_RANGES = [
  ["1D", 1],
  ["1W", 7],
  ["1M", 30],
  ["ALL", Infinity],
];

function fetchJson(path) {
  return fetch(path, { cache: "no-store" }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status}`);
    }
    return response.json();
  });
}

function useDashboardQuery(key, path, options = {}) {
  return useQuery({
    queryKey: key,
    queryFn: () => fetchJson(path),
    ...options,
  });
}

function money(value) {
  const numeric = Number(value ?? 0);
  const absolute = Math.abs(numeric);
  const maximumFractionDigits = absolute > 0 && absolute < 0.01 ? 6 : absolute > 0 && absolute < 1 ? 4 : 2;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits,
  }).format(numeric);
}

function compactMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    notation: Math.abs(Number(value ?? 0)) >= 1000 ? "compact" : "standard",
  }).format(Number(value ?? 0));
}

function number(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(Number(value ?? 0));
}

function shortAddress(value) {
  if (!value) {
    return "Unknown";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatTimestamp(value) {
  if (!value) {
    return "Unavailable";
  }

  return new Date(value).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function minutesSince(value) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }
  const numeric = Number(value);
  return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function parseRunErrors(notes) {
  if (!notes || !notes.includes("details=")) {
    return [];
  }
  return notes
    .split("details=")[1]
    .split(" | ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function groupProtocolSections(positions) {
  const grouped = new Map();
  for (const position of positions) {
    const key = position.protocol_section ?? position.protocol;
    const existing = grouped.get(key) ?? {
      key,
      label: position.protocol_label ?? position.protocol,
      totalUsd: 0,
      positions: [],
    };
    existing.totalUsd += Number(position.usd_value ?? 0);
    existing.positions.push(position);
    grouped.set(key, existing);
  }

  return [...grouped.values()]
    .map((section) => ({
      ...section,
      positions: section.positions.sort((left, right) => Number(right.usd_value) - Number(left.usd_value)),
    }))
    .sort((left, right) => right.totalUsd - left.totalUsd);
}

function filterHistory(history, range) {
  const days = HISTORY_RANGES.find(([label]) => label === range)?.[1] ?? Infinity;
  const sorted = [...history].reverse();
  if (!Number.isFinite(days)) {
    return sorted;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return sorted.filter((point) => new Date(point.snapshot_ts).getTime() >= cutoff);
}

function formatHistoryLabel(snapshotTs, range) {
  const date = new Date(snapshotTs);
  if (range === "1D") {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function chartHistory(history, range) {
  return filterHistory(history, range).map((point) => ({
    ...point,
    label: formatHistoryLabel(point.snapshot_ts, range),
  }));
}
function trackedDailyDelta(positions) {
  let delta = 0;
  let coveredUsd = 0;

  for (const position of positions) {
    for (const asset of position.quantity ?? []) {
      const usdValue = Number(asset.usd_value ?? 0);
      const change = asset.price_change_24h;
      if (!usdValue || change === null || change === undefined || Number(change) <= -99.9) {
        continue;
      }
      const previousUsd = usdValue / (1 + Number(change) / 100);
      delta += usdValue - previousUsd;
      coveredUsd += usdValue;
    }
  }

  return {
    delta,
    coveredUsd,
  };
}

function totalForMint(positions, mint) {
  return positions.reduce((total, position) => {
    const mintTotal = (position.quantity ?? [])
      .filter((asset) => asset.mint === mint)
      .reduce((sum, asset) => sum + Number(asset.amount ?? 0), 0);
    return total + mintTotal;
  }, 0);
}

function totalValueForMint(positions, mint) {
  return positions.reduce((total, position) => {
    const mintTotal = (position.quantity ?? [])
      .filter((asset) => asset.mint === mint)
      .reduce((sum, asset) => sum + Number(asset.usd_value ?? 0), 0);
    return total + mintTotal;
  }, 0);
}
function totalValueForProtocol(allocation, protocolKey) {
  return allocation.find((entry) => entry.protocol === protocolKey)?.total_usd ?? 0;
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function StatusPill({ generated, latestRun, watchingForRefresh }) {
  const ageMinutes = minutesSince(generated?.generated_at);
  const stale = ageMinutes > 45;
  const partial = latestRun?.status === "partial_success";
  const tone = partial ? "warning" : stale ? "muted" : "good";
  const label = partial ? "Partial export" : stale ? `Stale ${ageMinutes}m` : `Fresh ${ageMinutes}m`;

  return (
    <div className={`status-pill ${tone}`}>
      <span>{label}</span>
      {watchingForRefresh ? <strong>Watching for update...</strong> : null}
    </div>
  );
}

function WalletSelector({ wallets, scope, onChange }) {
  const combined = { scope: "combined", label: "All wallets", address: "3-wallet portfolio", accent: "#9ae6b4" };
  const options = [combined, ...wallets];

  return (
    <div className="wallet-selector">
      {options.map((wallet) => (
        <button
          key={wallet.scope}
          type="button"
          className={wallet.scope === scope ? "wallet-pill is-active" : "wallet-pill"}
          onClick={() => onChange(wallet.scope)}
        >
          <span className="wallet-avatar" style={{ background: wallet.accent ?? "#5eead4" }}>
            {(wallet.label ?? wallet.scope).slice(0, 2).toUpperCase()}
          </span>
          <span className="wallet-copy">
            <strong>{wallet.label}</strong>
            <span>{wallet.scope === "combined" ? wallet.address : shortAddress(wallet.address)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function SummaryMetric({ label, value, note, tone = "default" }) {
  return (
    <div className={`summary-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function HistoryTooltip({ active, payload }) {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0]?.payload ?? null;
  const value = payload[0]?.value ?? 0;

  return (
    <div className="history-tooltip">
      <span className="history-tooltip-kicker">Net worth</span>
      <strong>{money(value)}</strong>
      <small>{formatTimestamp(point?.snapshot_ts)}</small>
    </div>
  );
}

function HistoryPanel({ history, range, onRangeChange }) {
  const data = chartHistory(history, range);
  const sparseHistory = data.length === 1;

  return (
    <section className="hero-card chart-card">
      <div className="panel-head">
        <div>
          <span className="panel-kicker">History</span>
          <h2>Portfolio history</h2>
        </div>
        <div className="segmented-control">
          {HISTORY_RANGES.map(([label]) => (
            <button
              key={label}
              type="button"
              className={range === label ? "is-active" : ""}
              onClick={() => onRangeChange(label)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {data.length ? (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="historyFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#35f2c2" stopOpacity={0.34} />
                <stop offset="95%" stopColor="#35f2c2" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Tooltip
              cursor={{ stroke: "rgba(127, 141, 167, 0.5)", strokeWidth: 1, strokeDasharray: "4 6" }}
              content={<HistoryTooltip />}
            />
            <XAxis dataKey="label" tick={{ fill: "#6f7f9c", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={compactMoney} tick={{ fill: "#6f7f9c", fontSize: 12 }} axisLine={false} tickLine={false} />
            <Area
              type="monotone"
              dataKey="total_usd"
              stroke="#35f2c2"
              strokeWidth={2.5}
              fill="url(#historyFill)"
              dot={sparseHistory ? { r: 5, fill: "#35f2c2", stroke: "#eefef8", strokeWidth: 2 } : false}
              activeDot={{ r: 5, fill: "#35f2c2", stroke: "#eefef8", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <EmptyState title="No history yet" detail="Run at least one export cycle to draw the portfolio curve." />
      )}
    </section>
  );
}
function ProtocolChip({ section, active, onSelect }) {
  return (
    <button type="button" className={active ? "protocol-chip is-active" : "protocol-chip"} onClick={onSelect}>
      <span className="protocol-mark">{section.label.slice(0, 1)}</span>
      <span>
        <strong>{section.label}</strong>
        <small>{money(section.totalUsd)}</small>
      </span>
    </button>
  );
}

function lpSecondaryText(position) {
  const feesUsd = Number(position.raw?.fees_usd ?? 0);
  const incentiveRewardsUsd = Number(position.raw?.incentive_rewards_usd ?? 0);

  if (feesUsd > 0 && incentiveRewardsUsd > 0) {
    return `Fees ${money(feesUsd)} | Rewards ${money(incentiveRewardsUsd)}`;
  }

  if (feesUsd > 0) {
    return `Fees ${money(feesUsd)}`;
  }

  if (incentiveRewardsUsd > 0) {
    return `Rewards ${money(incentiveRewardsUsd)}`;
  }

  return "No unclaimed fees or rewards";
}

function PositionRow({ position }) {
  const singleAsset = (position.quantity?.length ?? 0) === 1;
  const primary = position.quantity?.[0] ?? null;
  const secondary = position.quantity?.[1] ?? null;
  const change = singleAsset ? position.price_change_24h : null;

  return (
    <div className="position-row">
      <div className="asset-cell">
        <div className="asset-icons">
          {position.quantity?.slice(0, 2).map((asset) =>
            asset.icon_url ? (
              <img key={`${position.position_key}-${asset.mint}`} src={asset.icon_url} alt="" />
            ) : (
              <span key={`${position.position_key}-${asset.mint}`} className="asset-fallback">
                {(asset.symbol ?? asset.name ?? asset.mint).slice(0, 2).toUpperCase()}
              </span>
            ),
          )}
        </div>
        <div>
          <strong>{position.asset_name}</strong>
          <span>
            {position.wallet_label}
            {position.protocol_section === "raydium" && position.raw?.position_nft_mint
              ? ` | ${shortAddress(position.raw.position_nft_mint)}`
              : ""}
          </span>
        </div>
      </div>

      <div className="position-col">
        {singleAsset ? <strong>{number(primary?.amount)}</strong> : <strong>{number(primary?.amount)} / {number(secondary?.amount)}</strong>}
        <span>{singleAsset ? primary?.symbol : `${primary?.symbol} / ${secondary?.symbol}`}</span>
      </div>

      <div className="position-col price-col">
        <strong>{singleAsset ? money(position.unit_price_usd) : position.raw?.pool_type ?? "CLMM"}</strong>
        <span className={singleAsset ? (Number(change) >= 0 ? "positive" : "negative") : ""}>
          {singleAsset ? pct(change) : lpSecondaryText(position)}
        </span>
      </div>

      <div className="position-col value-col">
        <strong>{money(position.usd_value)}</strong>
        <span>{position.protocol_label}</span>
      </div>
    </div>
  );
}
function ProtocolSection({ section }) {
  if (!section.positions.length) {
    return null;
  }

  return (
    <section className="protocol-section">
      <div className="protocol-section-head">
        <div>
          <span className="protocol-badge">{section.label.slice(0, 1)}</span>
          <div>
            <h3>{section.label}</h3>
            <span>{section.positions.length} positions</span>
          </div>
        </div>
        <strong>{money(section.totalUsd)}</strong>
      </div>

      <div className="position-table">
        <div className="position-header">
          <span>Asset</span>
          <span>Balance</span>
          <span>Price / 24h</span>
          <span>Value</span>
        </div>
        {section.positions.map((position) => (
          <PositionRow key={position.position_key} position={position} />
        ))}
      </div>
    </section>
  );
}

function SidePanel({ latestRun, walletAllocation, generated, prices }) {
  const errors = parseRunErrors(latestRun?.notes);
  const solPrice = prices.find((price) => price.mint === "So11111111111111111111111111111111111111112")?.price_usd ?? null;

  return (
    <aside className="side-panel">
      <section className="side-card">
        <div className="panel-head compact">
          <div>
            <span className="panel-kicker">Wallet split</span>
            <h2>Allocation</h2>
          </div>
        </div>
        <div className="wallet-split-list">
          {walletAllocation.length ? (
            walletAllocation.map((wallet) => (
              <div key={wallet.wallet_scope} className="wallet-split-row">
                <span>{wallet.wallet}</span>
                <strong>{money(wallet.total_usd)}</strong>
              </div>
            ))
          ) : (
            <EmptyState title="No allocation yet" detail="Wallet totals appear after the first successful export." />
          )}
        </div>
        {solPrice ? <small className="side-foot">SOL price: {money(solPrice)}</small> : null}
      </section>

      <section className="side-card">
        <div className="panel-head compact">
          <div>
            <span className="panel-kicker">Run health</span>
            <h2>Ingestion status</h2>
          </div>
        </div>
        {latestRun ? (
          <>
            <div className={`run-health ${latestRun.status}`}>
              <div>
                <strong>{latestRun.status.replace(/_/g, " ")}</strong>
                <span>{latestRun.error_count} errors</span>
              </div>
              <span>{formatTimestamp(latestRun.ended_at ?? latestRun.started_at)}</span>
            </div>
            <div className="error-list">
              {(errors.length ? errors.slice(0, 6) : [latestRun.notes]).map((entry, index) => (
                <p key={`${entry}-${index}`}>{entry}</p>
              ))}
            </div>
            <small className="side-foot">Published {formatTimestamp(generated?.generated_at)}</small>
          </>
        ) : (
          <EmptyState title="No runs yet" detail="The workflow needs one completed export before run health appears." />
        )}
      </section>
    </aside>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState("combined");
  const [historyRange, setHistoryRange] = useState("1M");
  const [protocolFilter, setProtocolFilter] = useState("all");
  const [watchingForRefresh, setWatchingForRefresh] = useState(false);
  const [refreshBaseline, setRefreshBaseline] = useState(null);
  const deferredScope = useDeferredValue(scope);

  const generatedQuery = useDashboardQuery(["generated"], `${DATA_BASE}/generated.json`, {
    refetchInterval: watchingForRefresh ? 20_000 : false,
  });
  const summaryQuery = useDashboardQuery(["summary", deferredScope], `${DATA_BASE}/summary/${deferredScope}.json`);
  const positionsQuery = useDashboardQuery(["positions", deferredScope], `${DATA_BASE}/positions/${deferredScope}.json`);
  const protocolAllocationQuery = useDashboardQuery(
    ["allocation", "protocol", deferredScope],
    `${DATA_BASE}/allocation/protocol/${deferredScope}.json`,
  );
  const walletAllocationQuery = useDashboardQuery(
    ["allocation", "wallet", deferredScope],
    `${DATA_BASE}/allocation/wallet/${deferredScope}.json`,
  );
  const historyQuery = useDashboardQuery(["history", deferredScope], `${DATA_BASE}/history/${deferredScope}.json`);
  const pricesQuery = useDashboardQuery(["prices"], `${DATA_BASE}/prices.json`);
  const runsQuery = useDashboardQuery(["runs"], `${DATA_BASE}/ingestion-runs.json`);

  const generated = generatedQuery.data;
  const wallets = generated?.wallets ?? [];
  const summary = summaryQuery.data?.summary;
  const positions = positionsQuery.data?.positions ?? [];
  const protocolAllocation = protocolAllocationQuery.data?.allocation ?? [];
  const walletAllocation = walletAllocationQuery.data?.allocation ?? [];
  const history = historyQuery.data?.history ?? [];
  const prices = pricesQuery.data?.prices ?? [];
  const runs = runsQuery.data?.runs ?? [];
  const latestRun = runs[0] ?? null;

  useEffect(() => {
    if (!watchingForRefresh || !refreshBaseline || !generated?.generated_at) {
      return;
    }

    if (new Date(generated.generated_at).getTime() > new Date(refreshBaseline).getTime()) {
      setWatchingForRefresh(false);
      queryClient.invalidateQueries();
    }
  }, [generated?.generated_at, queryClient, refreshBaseline, watchingForRefresh]);

  const isLoading =
    generatedQuery.isLoading ||
    summaryQuery.isLoading ||
    positionsQuery.isLoading ||
    protocolAllocationQuery.isLoading ||
    walletAllocationQuery.isLoading ||
    historyQuery.isLoading ||
    pricesQuery.isLoading ||
    runsQuery.isLoading;

  const error = [
    generatedQuery.error,
    summaryQuery.error,
    positionsQuery.error,
    protocolAllocationQuery.error,
    walletAllocationQuery.error,
    historyQuery.error,
    pricesQuery.error,
    runsQuery.error,
  ].find(Boolean);

  const sections = groupProtocolSections(positions);
  const visibleSections = protocolFilter === "all" ? sections : sections.filter((section) => section.key === protocolFilter);
  const dailyDelta = trackedDailyDelta(positions);
  const urmomQuantity = totalForMint(positions, "9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump");
  const solTracked = totalForMint(positions, "So11111111111111111111111111111111111111112");
  const solTrackedUsd = totalValueForMint(positions, "So11111111111111111111111111111111111111112");
  const marinadeValue = totalValueForProtocol(protocolAllocation, "marinade");
  const raydiumValue = totalValueForProtocol(protocolAllocation, "raydium");
  const solPrice = prices.find((price) => price.mint === "So11111111111111111111111111111111111111112")?.price_usd ?? 0;
  const scopeTitle = scope === "combined" ? "All wallets" : wallets.find((wallet) => wallet.scope === scope)?.label ?? scope;
  const selectedWallet = wallets.find((wallet) => wallet.scope === scope) ?? null;
  const protocolTabs = [{ key: "all", label: "All", totalUsd: summary?.total_usd ?? 0 }, ...sections];

  const handleScopeChange = (nextScope) => {
    startTransition(() => {
      setScope(nextScope);
      setProtocolFilter("all");
    });
  };

  const handleManualRefresh = () => {
    if (generated?.manual_refresh_url) {
      window.open(generated.manual_refresh_url, "_blank", "noopener,noreferrer");
    }

    setRefreshBaseline(generated?.generated_at ?? new Date().toISOString());
    setWatchingForRefresh(true);
    queryClient.invalidateQueries({ queryKey: ["generated"] });
  };

  return (
    <div className="jup-shell">
      <div className="orb orb-a" />
      <div className="orb orb-b" />

      <header className="topbar">
        <div>
          <span className="page-kicker">Portfolio</span>
          <h1>Wallet Dashboard</h1>
        </div>
        <div className="topbar-actions">
          <StatusPill generated={generated} latestRun={latestRun} watchingForRefresh={watchingForRefresh} />
          <button type="button" className="refresh-button" onClick={handleManualRefresh}>
            Refresh export
          </button>
        </div>
      </header>

      <WalletSelector wallets={wallets} scope={scope} onChange={handleScopeChange} />

      {isLoading ? <section className="status-card">Loading portfolio data...</section> : null}
      {error ? <section className="status-card error">Failed to load dashboard data: {error.message}</section> : null}

      {!isLoading && !error ? (
        <>
          <section className="hero-grid">
            <section className="hero-card summary-card">
              <div className="panel-head compact">
                <div>
                  <span className="panel-kicker">Net worth</span>
                  <h2>{scopeTitle}</h2>
                </div>
                <span className="export-stamp">Updated {formatTimestamp(generated?.generated_at)}</span>
              </div>

              <div className="net-worth-row">
                <div>
                  <div className="net-worth-value">{money(summary?.total_usd)}</div>
                  <div className="net-worth-subtle">{number(solTracked, 2)} SOL tracked across positions</div>
                </div>
                <div className={dailyDelta.delta >= 0 ? "delta-pill positive" : "delta-pill negative"}>
                  {dailyDelta.delta >= 0 ? "+" : ""}{money(dailyDelta.delta)}
                  <span>from tracked 24h moves</span>
                </div>
              </div>

              <div className="summary-grid">
                <SummaryMetric
                  label="URMOM holdings"
                  value={number(urmomQuantity, 0)}
                  note={money(
                    positions.reduce(
                      (total, position) =>
                        total +
                        (position.quantity ?? [])
                          .filter((asset) => asset.mint === "9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump")
                          .reduce((sum, asset) => sum + Number(asset.usd_value ?? 0), 0),
                      0,
                    ),
                  )}
                />
                <SummaryMetric label="SOL holdings" value={`${number(solTracked, 2)} SOL`} note={money(solTrackedUsd)} />
                <SummaryMetric label="Marinade" value={money(marinadeValue)} note="Native + liquid staking" tone="accent" />
                <SummaryMetric label="Raydium" value={money(raydiumValue)} note="CLMM liquidity positions" tone="accent" />
              </div>

              <div className="summary-foot">
                <span>{positions.length} live positions</span>
                <span>{selectedWallet ? selectedWallet.address : "Combined scope across all 3 wallets"}</span>
              </div>
            </section>

            <HistoryPanel history={history} range={historyRange} onRangeChange={setHistoryRange} />
          </section>

          <section className="content-layout">
            <main>
              <div className="protocol-chip-row">
                {protocolTabs.map((section) => (
                  <ProtocolChip
                    key={section.key}
                    section={section}
                    active={protocolFilter === section.key}
                    onSelect={() => setProtocolFilter(section.key)}
                  />
                ))}
              </div>

              {visibleSections.length ? (
                visibleSections.map((section) => <ProtocolSection key={section.key} section={section} />)
              ) : (
                <section className="protocol-section">
                  <EmptyState title="No priced positions" detail="The current export has positions, but they still need market prices to render here." />
                </section>
              )}
            </main>

            <SidePanel latestRun={latestRun} walletAllocation={walletAllocation} generated={generated} prices={prices} />
          </section>
        </>
      ) : null}
    </div>
  );
}
