"use client";

import { NETWORK_LABEL } from "@sable/config";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useIsDeployed, useNetworkGuard, useProtocolState } from "@/lib/hooks/use-sable";

/**
 * Blocking conditions surfaced at the top of the app.
 *
 * Each one states what is wrong and what to do about it. A confidential app on the wrong
 * network does not fail politely — the coprocessor simply is not deployed there — so this
 * is explicit rather than left to a puzzling revert later in a deposit flow.
 */
export function NetworkBanner() {
  const { isConnected } = useAccount();
  const { wrongNetwork, switchToSable, switching } = useNetworkGuard();
  const deployed = useIsDeployed();
  const { paused } = useProtocolState();

  if (!deployed) {
    return (
      <Banner tone="caution">
        <span>
          Sable is not deployed on this environment yet. Contract addresses are missing, so
          balances and rounds cannot be read.
        </span>
      </Banner>
    );
  }

  if (isConnected && wrongNetwork) {
    return (
      <Banner tone="caution">
        <span>Sable currently runs on {NETWORK_LABEL}.</span>
        <Button size="sm" variant="primary" loading={switching} onClick={switchToSable}>
          Switch network
        </Button>
      </Banner>
    );
  }

  if (paused) {
    return (
      <Banner tone="caution">
        <span>
          Sable is paused for maintenance. Deposits and mode changes are unavailable —
          withdrawals remain open.
        </span>
      </Banner>
    );
  }

  return null;
}

function Banner({ children, tone }: { children: React.ReactNode; tone: "caution" | "danger" }) {
  const border = tone === "caution" ? "border-[rgba(240,165,0,0.28)]" : "border-[rgba(255,107,107,0.3)]";
  const bg = tone === "caution" ? "bg-[rgba(240,165,0,0.06)]" : "bg-[rgba(255,107,107,0.06)]";

  // Children render directly into the flex row rather than inside a paragraph: some
  // banners carry an action button, and a <button> nested in a <p> is invalid markup.
  return (
    <div role="status" className={`border-b ${border} ${bg}`}>
      <div className="mx-auto flex max-w-[880px] flex-col gap-3 px-5 py-3.5 text-[13px] leading-relaxed text-[var(--color-primary)] sm:flex-row sm:items-center sm:justify-between sm:px-8">
        {children}
      </div>
    </div>
  );
}
