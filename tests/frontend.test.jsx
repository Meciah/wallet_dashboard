import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { App } from "../src/web/App.jsx";

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("frontend dashboard", () => {
  it("loads combined data, switches scope, shows partial-success state, and opens manual refresh", async () => {
    const responses = {
      "/data/generated.json": {
        generated_at: "2026-04-02T18:46:10.302Z",
        last_successful_export_at: "2026-04-02T18:46:10.302Z",
        commit_sha: "abc123",
        repository: "owner/repo",
        workflow_url: "https://github.com/owner/repo/actions/runs/1",
        manual_refresh_url: "https://github.com/owner/repo/actions/workflows/update-data.yml",
        latest_run_status: "partial_success",
        latest_run_started_at: "2026-04-02T18:45:48.266Z",
        latest_run_ended_at: "2026-04-02T18:46:10.208Z"
      },
      "/data/summary/combined.json": {
        scope: "combined",
        summary: { scope: "combined", total_usd: 50, snapshot_ts: "2026-04-02T18:46:10.302Z", pnl_24h: null, pnl_7d: null }
      },
      "/data/summary/wallet_2.json": {
        scope: "wallet_2",
        summary: { scope: "wallet_2", total_usd: 25, snapshot_ts: "2026-04-02T18:46:10.302Z", pnl_24h: null, pnl_7d: null }
      },
      "/data/positions/combined.json": {
        scope: "combined",
        count: 1,
        positions: [
          {
            wallet_label: "wallet_1",
            wallet_address: "3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R",
            protocol: "wallet_tokens",
            protocol_category: "wallet",
            position_type: "wallet_balance",
            position_key: "k1",
            usd_value: 50,
            updated_at: "2026-04-02T18:46:10.302Z",
            raw: {}
          }
        ]
      },
      "/data/positions/wallet_2.json": {
        scope: "wallet_2",
        count: 1,
        positions: [
          {
            wallet_label: "wallet_2",
            wallet_address: "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
            protocol: "marinade",
            protocol_category: "staking",
            position_type: "staking",
            position_key: "k2",
            usd_value: 25,
            updated_at: "2026-04-02T18:46:10.302Z",
            raw: {}
          }
        ]
      },
      "/data/allocation/protocol/combined.json": {
        scope: "combined",
        by: "protocol",
        count: 1,
        allocation: [{ protocol: "wallet_tokens", total_usd: 50 }]
      },
      "/data/allocation/protocol/wallet_2.json": {
        scope: "wallet_2",
        by: "protocol",
        count: 1,
        allocation: [{ protocol: "marinade", total_usd: 25 }]
      },
      "/data/allocation/wallet/combined.json": {
        scope: "combined",
        by: "wallet",
        count: 1,
        allocation: [{ wallet: "wallet_1", total_usd: 50 }]
      },
      "/data/allocation/wallet/wallet_2.json": {
        scope: "wallet_2",
        by: "wallet",
        count: 1,
        allocation: [{ wallet: "wallet_2", total_usd: 25 }]
      },
      "/data/history/combined.json": {
        scope: "combined",
        count: 1,
        history: [{ snapshot_ts: "2026-04-02T18:46:10.302Z", total_usd: 50, scope: "combined", pnl_24h: null, pnl_7d: null }]
      },
      "/data/history/wallet_2.json": {
        scope: "wallet_2",
        count: 1,
        history: [{ snapshot_ts: "2026-04-02T18:46:10.302Z", total_usd: 25, scope: "wallet_2", pnl_24h: null, pnl_7d: null }]
      },
      "/data/prices.json": {
        count: 1,
        prices: [{ mint: "So11111111111111111111111111111111111111112", asof_ts: "2026-04-02T18:46:10.302Z", price_usd: 100, source: "provider_chain", confidence: null }]
      },
      "/data/ingestion-runs.json": {
        count: 1,
        runs: [{ id: 1, started_at: "2026-04-02T18:45:48.266Z", ended_at: "2026-04-02T18:46:10.208Z", status: "partial_success", error_count: 2, notes: "errors happened" }]
      }
    };

    global.fetch = vi.fn((input) => {
      const url = typeof input === "string" ? input : input.url;
      const pathname = new URL(url, "https://example.test").pathname;
      const payload = responses[pathname];
      if (!payload) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return Promise.resolve(jsonResponse(payload));
    });

    renderApp();

    await screen.findByText("Wallet Dashboard");
    await screen.findByText("Portfolio Value");
    expect(screen.getByText("Partial success")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Wallet 2" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Wallet 2" })).toHaveClass("is-active");
    });

    await userEvent.click(screen.getByRole("button", { name: "Run manual refresh" }));

    expect(window.open).toHaveBeenCalledWith(
      "https://github.com/owner/repo/actions/workflows/update-data.yml",
      "_blank",
      "noopener,noreferrer",
    );

    await waitFor(() => {
      expect(screen.getByText("Watching for updated export…")).toBeInTheDocument();
    });
  });
});
