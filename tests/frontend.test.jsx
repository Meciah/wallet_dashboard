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
  it("loads portfolio data, switches scope, shows partial export health, and opens manual refresh", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
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
        latest_run_ended_at: "2026-04-02T18:46:10.208Z",
        wallets: [
          {
            scope: "wallet_1",
            label: "3dhj...VK7R",
            address: "3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R",
            accent: "#7ee787",
          },
          {
            scope: "wallet_2",
            label: "ELKy...caGS",
            address: "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
            accent: "#4ad8ff",
          },
          {
            scope: "wallet_3",
            label: "CRsH...9zcf",
            address: "CRsHntQirTYe9zwZYYMJpt6Wm6TaZyncUYF4TgW39zcf",
            accent: "#b892ff",
          },
        ],
      },
      "/data/summary/combined.json": {
        scope: "combined",
        summary: { scope: "combined", total_usd: 4074.8, snapshot_ts: "2026-04-02T18:46:10.302Z", pnl_24h: null, pnl_7d: null },
      },
      "/data/summary/wallet_2.json": {
        scope: "wallet_2",
        summary: { scope: "wallet_2", total_usd: 612.5, snapshot_ts: "2026-04-02T18:46:10.302Z", pnl_24h: null, pnl_7d: null },
      },
      "/data/positions/combined.json": {
        scope: "combined",
        count: 3,
        positions: [
          {
            wallet_scope: "wallet_1",
            wallet_label: "3dhj...VK7R",
            wallet_address: "3dhjRbTXZaVeNkUNuXfdrfuJXGFwVhQJLYC39anFVK7R",
            wallet_accent: "#7ee787",
            protocol: "wallet_tokens",
            protocol_label: "Holdings",
            protocol_section: "holdings",
            protocol_category: "wallet",
            position_type: "wallet_balance",
            position_key: "holdings-urmom",
            usd_value: 3323.8,
            updated_at: "2026-04-02T18:46:10.302Z",
            quantity: [
              {
                mint: "9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump",
                symbol: "URMOM",
                name: "URMOM",
                amount: 20077412,
                decimals: 6,
                price_usd: 0.00016554,
                price_change_24h: -0.61,
                usd_value: 3323.8,
                icon_url: null,
              },
            ],
            asset_mint: "9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump",
            asset_symbol: "URMOM",
            asset_name: "URMOM",
            icon_url: null,
            unit_price_usd: 0.00016554,
            price_change_24h: -0.61,
            rewards_usd: 0,
            raw: { display_name: "URMOM", display_symbol: "URMOM" },
          },
          {
            wallet_scope: "wallet_2",
            wallet_label: "ELKy...caGS",
            wallet_address: "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
            wallet_accent: "#4ad8ff",
            protocol: "marinade_native",
            protocol_label: "Marinade",
            protocol_section: "marinade",
            protocol_category: "staking",
            position_type: "staking",
            position_key: "marinade-native",
            usd_value: 550.1,
            updated_at: "2026-04-02T18:46:10.302Z",
            quantity: [
              {
                mint: "So11111111111111111111111111111111111111112",
                symbol: "SOL",
                name: "Marinade Native",
                amount: 7,
                decimals: 9,
                price_usd: 78.586,
                price_change_24h: -4.28,
                usd_value: 550.1,
                icon_url: null,
              },
            ],
            asset_mint: "So11111111111111111111111111111111111111112",
            asset_symbol: "SOL",
            asset_name: "Marinade Native",
            icon_url: null,
            unit_price_usd: 78.586,
            price_change_24h: -4.28,
            rewards_usd: 0,
            raw: { display_name: "Marinade Native", display_symbol: "mNative" },
          },
          {
            wallet_scope: "wallet_2",
            wallet_label: "ELKy...caGS",
            wallet_address: "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
            wallet_accent: "#4ad8ff",
            protocol: "raydium",
            protocol_label: "Raydium",
            protocol_section: "raydium",
            protocol_category: "lp",
            position_type: "lp",
            position_key: "raydium-clmm-1",
            usd_value: 200.9,
            updated_at: "2026-04-02T18:46:10.302Z",
            quantity: [
              {
                mint: "So11111111111111111111111111111111111111112",
                symbol: "SOL",
                name: "Solana",
                amount: 2.5,
                decimals: 9,
                price_usd: 78.586,
                price_change_24h: -4.28,
                usd_value: 196.46,
                icon_url: null,
              },
              {
                mint: "9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump",
                symbol: "URMOM",
                name: "URMOM",
                amount: 26800,
                decimals: 6,
                price_usd: 0.00016554,
                price_change_24h: -0.61,
                usd_value: 4.44,
                icon_url: null,
              },
            ],
            asset_mint: "So11111111111111111111111111111111111111112",
            asset_symbol: "SOL/URMOM",
            asset_name: "SOL / URMOM",
            icon_url: null,
            unit_price_usd: null,
            price_change_24h: null,
            rewards_usd: 12.5,
            raw: {
              display_name: "SOL / URMOM",
              display_symbol: "CLMM",
              pool_type: "Concentrated",
              position_nft_mint: "5rs98PFHcud13vxcuqFy3h4t3Y3QzV3VxvyYQX15qyLq",
            },
          },
        ],
      },
      "/data/positions/wallet_2.json": {
        scope: "wallet_2",
        count: 2,
        positions: [
          {
            wallet_scope: "wallet_2",
            wallet_label: "ELKy...caGS",
            wallet_address: "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
            wallet_accent: "#4ad8ff",
            protocol: "marinade_native",
            protocol_label: "Marinade",
            protocol_section: "marinade",
            protocol_category: "staking",
            position_type: "staking",
            position_key: "marinade-native",
            usd_value: 550.1,
            updated_at: "2026-04-02T18:46:10.302Z",
            quantity: [
              {
                mint: "So11111111111111111111111111111111111111112",
                symbol: "SOL",
                name: "Marinade Native",
                amount: 7,
                decimals: 9,
                price_usd: 78.586,
                price_change_24h: -4.28,
                usd_value: 550.1,
                icon_url: null,
              },
            ],
            asset_mint: "So11111111111111111111111111111111111111112",
            asset_symbol: "SOL",
            asset_name: "Marinade Native",
            icon_url: null,
            unit_price_usd: 78.586,
            price_change_24h: -4.28,
            rewards_usd: 0,
            raw: { display_name: "Marinade Native", display_symbol: "mNative" },
          },
          {
            wallet_scope: "wallet_2",
            wallet_label: "ELKy...caGS",
            wallet_address: "ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS",
            wallet_accent: "#4ad8ff",
            protocol: "raydium",
            protocol_label: "Raydium",
            protocol_section: "raydium",
            protocol_category: "lp",
            position_type: "lp",
            position_key: "raydium-clmm-1",
            usd_value: 62.4,
            updated_at: "2026-04-02T18:46:10.302Z",
            quantity: [
              {
                mint: "So11111111111111111111111111111111111111112",
                symbol: "SOL",
                name: "Solana",
                amount: 0.75,
                decimals: 9,
                price_usd: 78.586,
                price_change_24h: -4.28,
                usd_value: 58.94,
                icon_url: null,
              },
              {
                mint: "9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump",
                symbol: "URMOM",
                name: "URMOM",
                amount: 20900,
                decimals: 6,
                price_usd: 0.00016554,
                price_change_24h: -0.61,
                usd_value: 3.46,
                icon_url: null,
              },
            ],
            asset_mint: "So11111111111111111111111111111111111111112",
            asset_symbol: "SOL/URMOM",
            asset_name: "SOL / URMOM",
            icon_url: null,
            unit_price_usd: null,
            price_change_24h: null,
            rewards_usd: 12.5,
            raw: {
              display_name: "SOL / URMOM",
              display_symbol: "CLMM",
              pool_type: "Concentrated",
              position_nft_mint: "5rs98PFHcud13vxcuqFy3h4t3Y3QzV3VxvyYQX15qyLq",
            },
          },
        ],
      },
      "/data/allocation/protocol/combined.json": {
        scope: "combined",
        by: "protocol",
        count: 3,
        allocation: [
          { protocol: "holdings", protocol_label: "Holdings", protocols: ["wallet_tokens"], total_usd: 3323.8 },
          { protocol: "marinade", protocol_label: "Marinade", protocols: ["marinade", "marinade_native"], total_usd: 550.1 },
          { protocol: "raydium", protocol_label: "Raydium", protocols: ["raydium"], total_usd: 200.9 },
        ],
      },
      "/data/allocation/protocol/wallet_2.json": {
        scope: "wallet_2",
        by: "protocol",
        count: 2,
        allocation: [
          { protocol: "marinade", protocol_label: "Marinade", protocols: ["marinade", "marinade_native"], total_usd: 550.1 },
          { protocol: "raydium", protocol_label: "Raydium", protocols: ["raydium"], total_usd: 62.4 },
        ],
      },
      "/data/allocation/wallet/combined.json": {
        scope: "combined",
        by: "wallet",
        count: 2,
        allocation: [
          { wallet_scope: "wallet_1", wallet: "3dhj...VK7R", total_usd: 3323.8 },
          { wallet_scope: "wallet_2", wallet: "ELKy...caGS", total_usd: 751.0 },
        ],
      },
      "/data/allocation/wallet/wallet_2.json": {
        scope: "wallet_2",
        by: "wallet",
        count: 1,
        allocation: [{ wallet_scope: "wallet_2", wallet: "ELKy...caGS", total_usd: 612.5 }],
      },
      "/data/history/combined.json": {
        scope: "combined",
        count: 2,
        history: [
          { snapshot_ts: "2026-03-20T18:46:10.302Z", total_usd: 3600, scope: "combined", pnl_24h: null, pnl_7d: null },
          { snapshot_ts: "2026-04-02T18:46:10.302Z", total_usd: 4074.8, scope: "combined", pnl_24h: null, pnl_7d: null },
        ],
      },
      "/data/history/wallet_2.json": {
        scope: "wallet_2",
        count: 2,
        history: [
          { snapshot_ts: "2026-03-20T18:46:10.302Z", total_usd: 500.3, scope: "wallet_2", pnl_24h: null, pnl_7d: null },
          { snapshot_ts: "2026-04-02T18:46:10.302Z", total_usd: 612.5, scope: "wallet_2", pnl_24h: null, pnl_7d: null },
        ],
      },
      "/data/prices.json": {
        count: 2,
        prices: [
          { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", icon_url: null, asof_ts: "2026-04-02T18:46:10.302Z", price_usd: 78.586, source: "provider_chain", confidence: null },
          { mint: "9j6twpYWrV1ueJok76D9YK8wJTVoG9Zy8spC7wnTpump", symbol: "URMOM", name: "URMOM", icon_url: null, asof_ts: "2026-04-02T18:46:10.302Z", price_usd: 0.00016554, source: "provider_chain", confidence: null },
        ],
      },
      "/data/ingestion-runs.json": {
        count: 1,
        runs: [
          {
            id: 1,
            started_at: "2026-04-02T18:45:48.266Z",
            ended_at: "2026-04-02T18:46:10.208Z",
            status: "partial_success",
            error_count: 2,
            notes: "positions_written=3; errors=2; details=wallet=wallet_2 adapter=marinade_native error=HTTP Error 429: Too Many Requests | wallet=wallet_3 adapter=lp_tokens error=HTTP Error 429: Too Many Requests",
          },
        ],
      },
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
    await screen.findByText("Net worth");
    await screen.findByText("URMOM holdings");
    expect(screen.getByText("Partial export")).toBeInTheDocument();
    expect(screen.getAllByText("Raydium").length).toBeGreaterThan(0);

    const wallet2Button = screen.getAllByText("ELKy...caGS")[0].closest("button");
    await userEvent.click(wallet2Button);

    await waitFor(() => {
      expect(wallet2Button).toHaveClass("is-active");
      expect(screen.getByText("ELKyH6iy7Qift7bze1kg6Z6aeCuzjhCwt3MtVMnMcaGS")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Refresh export/i }));

    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/owner/repo/actions/workflows/update-data.yml",
      "_blank",
      "noopener,noreferrer",
    );

    await waitFor(() => {
      expect(screen.getByText("Watching for update...")).toBeInTheDocument();
    });

    openSpy.mockRestore();
  });
});
