"use client";

import { deployment, explorer } from "@sable/config";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { FAUCET_AMOUNT, useFaucet } from "@/lib/hooks/use-faucet";

/**
 * The way in.
 *
 * Sable custodies Zama's published confidential token and issues nothing of its own, so the
 * first question a new wallet faces is where to get the underlying at all. Without an answer
 * to that, every other feature is unreachable — which is a product failure, whatever the
 * purity argument for leaving it out.
 *
 * The button calls `mint` on **Zama's** `USDCMock`, the ERC-20 their own wrapper names as its
 * underlying. The copy says so, and links to the contract, because a savings product asking
 * for a signature should be specific about whose contract it is about to call.
 */
export function FaucetCard({
  className,
  onClaimed,
}: {
  className?: string;
  /** Refresh balances once tokens land. */
  onClaimed?: () => void | Promise<void>;
}) {
  const { notify } = useToast();
  const { claim, isBusy, error, available } = useFaucet();

  const underlying = deployment?.asset.underlying;
  const symbol = deployment?.asset.symbol.replace(/^c/, "") ?? "the test token";

  if (!underlying) return null;

  const onClaim = async () => {
    const hash = await claim();
    if (hash) {
      notify({
        title: `${FAUCET_AMOUNT.toLocaleString()} ${symbol} received`,
        description: `Shield it next to get the confidential token Sable accepts. Your wallet app will not list ${symbol} unless you add it as a custom token — Sable reads it straight from the chain.`,
        tone: "verified",
        txHash: hash,
      });
      await onClaimed?.();
    }
  };

  return (
    <div className={cn("surface-inset p-5", className)}>
      <p className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
        Need test tokens? This mints{" "}
        <span className="text-numeric text-[var(--color-primary)]">
          {FAUCET_AMOUNT.toLocaleString()} {symbol}
        </span>{" "}
        to your wallet, as many times as you press it. The same button sits in the bar above,
        so you can come back for more without emptying your balance first.
      </p>

      <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
        It calls the public mint on{" "}
        <a
          href={explorer.address(underlying)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-accent)] transition-opacity hover:opacity-75"
        >
          Zama&rsquo;s {symbol} contract ↗
        </a>{" "}
        — a testnet mock, open for anyone to call. Sable issues nothing.
      </p>

      <div className="mt-5">
        <Button size="md" onClick={onClaim} loading={isBusy} disabled={!available}>
          Get {FAUCET_AMOUNT.toLocaleString()} {symbol}
        </Button>
      </div>

      {error ? <ErrorNotice message={error} className="mt-4" /> : null}
    </div>
  );
}
