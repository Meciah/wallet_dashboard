import { useEffect, useState, startTransition, useDeferredValue } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SCOPES = [
  ["combined", "Combined"],
  ["wallet_1", "Wallet 1"],
  ["wallet_2", "Wallet 2"],
  ["wallet_3", "Wallet 3"],
];

const CHART_COLORS = ["#1d5b4f", "#ff8a3d", "#d6c15d", "#934f41", "#5a6ac4", "#2f8f9d", "#7d6e83"];
const DATA_BASE = `${import.meta.env.BASE_URL}data`;

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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function number(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function formatTimestamp(value) {
  if (!value) {
    return "Unavailable";
  }
  return new Date(value).toLocaleString();
}

function minutesSince(value) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
}

function buildTooltipValue(value) {
  return money(value);
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty-state">
      <p>{title}</p>
      <span>{detail}</span>
    </div>
  );
}

function StatusPill({ generated, latestRun, watchingForRefresh }) {
  const ageMinutes = minutesSince(generated?.generated_at);
  const stale = ageMinutes > 45;
  const partial = latestRun?.status === "partial_success";
  const tone = partial ? "warning" : stale ? "muted" : "good";
  const label = partial
    ? "Partial success"
    : stale
      ? `Stale by ${ageMinutes}m`
      : `Fresh ${ageMinutes}m ago`;

  return (
    <div className={`status-pill ${tone}`}>
      <span>{label}</span>
      {watchingForRefresh ? <strong>Watching for updated export…</strong> : null}
    </div>
  );
}

function StatCard({ label, value, note }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function HistoryChart({ history }) {
  if (!history.length) {
    return <EmptyState title="No history yet" detail="Run ingestion and export to see portfolio trends." />;
  }

  const chartData = [...history]
    .reverse()
    .map((point) => ({ ...point, label: new Date(point.snapshot_ts).toLocaleDateString() }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={chartData}>
        <defs>
          <linearGradient id="historyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#1d5b4f" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#1d5b4f" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="#d0c7b9" />
        <XAxis dataKey="label" tick={{ fill: "#5b5449", fontSize: 12 }} />
        <YAxis tick={{ fill: "#5b5449", fontSize: 12 }} tickFormatter={money} />
        <Tooltip formatter={buildTooltipValue} />
        <Area type="monotone" dataKey="total_usd" stroke="#1d5b4f" fill="url(#historyFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function AllocationChart({ title, entries, dataKey }) {
  if (!entries.length) {
    return <EmptyState title={`No ${title.toLowerCase()} data`} detail="Allocation appears after positions are ingested." />;
  }

  return (
    <div className="chart-stack">
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={entries} dataKey="total_usd" nameKey={dataKey} innerRadius={58} outerRadius={94} paddingAngle={3}>
            {entries.map((entry, index) => (
              <Cell key={`${entry[dataKey]}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={buildTooltipValue} />
        </PieChart>
      </ResponsiveContainer>
      <div className="legend-list">
        {entries.map((entry, index) => (
          <div key={entry[dataKey]} className="legend-row">
            <span className="legend-swatch" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
            <b>{entry[dataKey]}</b>
            <span>{money(entry.total_usd)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PricesChart({ prices }) {
  if (!prices.length) {
    return <EmptyState title="No pricing data" detail="Prices appear after ingestion captures quoted mints." />;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={prices.slice(0, 8)}>
        <CartesianGrid strokeDasharray="4 4" stroke="#d0c7b9" />
        <XAxis dataKey="mint" tick={false} />
        <YAxis tick={{ fill: "#5b5449", fontSize: 12 }} tickFormatter={money} />
        <Tooltip formatter={buildTooltipValue} />
        <Bar dataKey="price_usd" fill="#ff8a3d" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState("combined");
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

  const positivePositions = positions.filter((position) => Number(position.usd_value) > 0);
  const topPositions = positivePositions.slice(0, 8);
  const lastUpdatedText = generated?.generated_at ? formatTimestamp(generated.generated_at) : "Unknown";

  const handleScopeChange = (nextScope) => {
    startTransition(() => {
      setScope(nextScope);
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

  const summaryCards = [
    {
      label: "Portfolio Value",
      value: money(summary?.total_usd),
      note: `Updated ${lastUpdatedText}`,
    },
    {
      label: "Visible Positions",
      value: number(positions.length),
      note: `${number(positivePositions.length)} with priced USD value`,
    },
    {
      label: "Latest Run",
      value: latestRun?.status ?? "unknown",
      note: latestRun ? `${latestRun.error_count} recorded errors` : "No ingestion runs yet",
    },
  ];

  return (
    <div className="app-shell">
      <div className="backdrop backdrop-one" />
      <div className="backdrop backdrop-two" />

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">SQLite-backed Solana tracking, rebuilt for JavaScript</p>
          <h1>Wallet Dashboard</h1>
          <p className="hero-detail">
            A GitHub Pages dashboard that queries published portfolio data on load, surfaces ingestion health, and keeps
            wallet, staking, and LP visibility in one place.
          </p>
        </div>

        <div className="hero-actions">
          <StatusPill generated={generated} latestRun={latestRun} watchingForRefresh={watchingForRefresh} />
          <button className="refresh-button" type="button" onClick={handleManualRefresh}>
            Run manual refresh
          </button>
          <small>
            Opens the GitHub Actions workflow page and then watches deployed metadata for the next completed export.
          </small>
        </div>
      </header>

      <section className="toolbar card">
        <div>
          <span className="section-label">Scope</span>
          <div className="scope-switcher">
            {SCOPES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={value === scope ? "is-active" : ""}
                onClick={() => handleScopeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-meta">
          <span>Last export</span>
          <strong>{lastUpdatedText}</strong>
        </div>
      </section>

      {isLoading ? <section className="card loading-state">Loading dashboard data…</section> : null}
      {error ? <section className="card error-state">Failed to load dashboard data: {error.message}</section> : null}

      {!isLoading && !error ? (
        <>
          <section className="stats-grid">
            {summaryCards.map((card) => (
              <StatCard key={card.label} label={card.label} value={card.value} note={card.note} />
            ))}
          </section>

          <section className="content-grid">
            <article className="card">
              <div className="card-head">
                <div>
                  <span className="section-label">History</span>
                  <h2>Portfolio timeline</h2>
                </div>
              </div>
              <HistoryChart history={history} />
            </article>

            <article className="card">
              <div className="card-head">
                <div>
                  <span className="section-label">Protocol Mix</span>
                  <h2>Allocation by protocol</h2>
                </div>
              </div>
              <AllocationChart title="Protocol" entries={protocolAllocation} dataKey="protocol" />
            </article>

            <article className="card">
              <div className="card-head">
                <div>
                  <span className="section-label">Wallet Split</span>
                  <h2>Allocation by wallet</h2>
                </div>
              </div>
              <AllocationChart title="Wallet" entries={walletAllocation} dataKey="wallet" />
            </article>

            <article className="card">
              <div className="card-head">
                <div>
                  <span className="section-label">Market Context</span>
                  <h2>Tracked prices</h2>
                </div>
              </div>
              <PricesChart prices={prices} />
            </article>
          </section>

          <section className="content-grid">
            <article className="card">
              <div className="card-head">
                <div>
                  <span className="section-label">Positions</span>
                  <h2>Highest value holdings</h2>
                </div>
              </div>
              {topPositions.length ? (
                <div className="position-list">
                  {topPositions.map((position) => (
                    <article key={position.position_key} className="position-item">
                      <div>
                        <strong>{position.protocol}</strong>
                        <span>{position.position_type}</span>
                      </div>
                      <div>
                        <strong>{money(position.usd_value)}</strong>
                        <span>{position.wallet_label}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState title="No priced positions" detail="Positions are present, but most mints currently have no USD quote." />
              )}
            </article>

            <article className="card">
              <div className="card-head">
                <div>
                  <span className="section-label">Run Health</span>
                  <h2>Ingestion status</h2>
                </div>
              </div>
              {runs.length ? (
                <div className="runs-list">
                  {runs.slice(0, 6).map((run) => (
                    <article key={run.id} className={`run-item ${run.status}`}>
                      <div>
                        <strong>Run #{run.id}</strong>
                        <span>{run.status}</span>
                      </div>
                      <div>
                        <strong>{run.error_count} errors</strong>
                        <span>{formatTimestamp(run.ended_at ?? run.started_at)}</span>
                      </div>
                      <p>{run.notes}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState title="No ingestion runs yet" detail="Run the backend ingestion job to populate operational history." />
              )}
            </article>
          </section>
        </>
      ) : null}
    </div>
  );
}
