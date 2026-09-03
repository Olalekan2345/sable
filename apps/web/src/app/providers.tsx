"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { createWagmiConfig } from "@/lib/wagmi";
import { appKitEnabled, initAppKit, wagmiAdapter } from "@/lib/appkit";
import { RestoreSession } from "@/components/shell/restore-session";
import { ToastProvider } from "@/components/ui/toast";

/**
 * Client-side providers.
 *
 * The wagmi config and query client are created inside state so they survive fast refresh
 * and are never shared across requests during SSR.
 */
export function Providers({ children }: { children: ReactNode }) {
  // AppKit owns the wagmi config when it is enabled, so it can register its own connectors
  // beside the browser extensions wagmi discovers. Without a project id it cannot start, and
  // Sable falls back to its own picker on a plain config.
  const [config] = useState(() => {
    if (appKitEnabled && wagmiAdapter) {
      initAppKit();
      return wagmiAdapter.wagmiConfig;
    }
    return createWagmiConfig();
  });
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Confidential state changes only when the saver acts, and every read is an
            // RPC round trip, so aggressive refetching buys nothing but noise.
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RestoreSession />
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
