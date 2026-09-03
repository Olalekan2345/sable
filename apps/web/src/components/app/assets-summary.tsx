"use client";

import { TokenMark } from "@/components/brand/token-mark";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { formatTokenAmount } from "@/components/ui/token-amount-input";
import { usePortfolio } from "@/lib/hooks/use-portfolio";

/**
 * A glance at the wallet's holdings, from the dashboard.
 *
 * Only **public** balances appear here. Shielded ones are deliberately absent rather than
 * shown masked: the dashboard already carries the saver's position behind a reveal, and a
 * second row of locked figures would add weight without adding information. The assets page
 * is where the shielded side is actually actionable.
 *
 * Nothing renders when the wallet holds no public token — an empty row of zeroes is not a
 * state worth occupying the dashboard with.
 */
export function AssetsSummary() {
  const { holdings, hasPublicBalance, isLoading } = usePortfolio();

  if (isLoading || !hasPublicBalance) return null;

  const held = holdings.filter((holding) => holding.publicBalance > 0n);

  return (
    <Card className="p-6">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <p className="text-eyebrow">Public tokens in this wallet</p>
        <ButtonLink href="/app/assets" variant="ghost" size="sm">
          All assets
        </ButtonLink>
      </div>

      <ul className="flex flex-col gap-3">
        {held.map(({ asset, publicBalance }) => (
          <li key={asset.address} className="flex items-center gap-3">
            <TokenMark symbol={asset.symbol} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-secondary)]">
              {asset.symbol.replace(/^c/, "")}
            </span>
            <span className="text-numeric shrink-0 text-[13px] text-[var(--color-primary)]">
              {formatTokenAmount(publicBalance, asset.underlyingDecimals)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
