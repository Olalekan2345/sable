"use client";

import { useCallback } from "react";

import { appKitEnabled, openAppKit } from "@/lib/appkit";

/**
 * Opens whichever wallet chooser this deployment has.
 *
 * One call site, two implementations: Reown AppKit when a project id is configured, and
 * Sable's own EIP-6963 picker when it is not. No component upstream has to know which is
 * active.
 *
 * `openAppKit` reports failure rather than throwing, so if AppKit is enabled but has not
 * finished initialising the click still opens the built-in picker. A connect button that
 * silently does nothing is the one outcome worth engineering against.
 */
export function useConnectWallet(openFallback: () => void): () => void {
  return useCallback(() => {
    if (appKitEnabled && openAppKit()) return;
    openFallback();
  }, [openFallback]);
}
