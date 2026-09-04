"use client";

import Link from "next/link";

import { TokenMark } from "@/components/brand/token-mark";
import { Badge } from "@/components/ui/primitives";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { formatTokenAmount } from "@/components/ui/token-amount-input";
import { useReveal } from "@/lib/hooks/use-reveal";
import type { AssetHolding } from "@/lib/hooks/use-portfolio";

/**
 * One asset in the holdings view.
 *
 * The two balances are presented differently on purpose. The public one is simply printed —
 * it is a `uint256` anyone can read, and dressing it up as protected would be a lie. The
 * shielded one is masked until its owner asks for it, because that is the only state in
 * which it is legible to anybody, including this interface.
 *
 * The reveal is per asset rather than per page. Someone checking one balance over a shoulder
 * should not have every other holding appear alongside it.
 */
export function AssetRow({
  holding,
  authorizeFor,
}: {
  holding: AssetHolding;
  /** Contract set the signature should cover, so later reveals need no further prompt. */
  authorizeFor: string[];
}) {
  const { asset, publicBalance, shieldedHandle, isVaultAsset } = holding;

  const reveal = useReveal(shieldedHandle, {
    contractAddress: asset.address,
    authorizeFor,
  });

  const shielded =
    reveal.state === "revealed" && typeof reveal.value === "bigint" ? reveal.value : null;

  // The symbol shown is the underlying's — `USDCMock` rather than `cUSDCMock` — because the
  // row covers both sides of the wrapper and the public balance is the one in that unit.
  const underlyingSymbol = asset.symbol.replace(/^c/, "");

  return (
    <div className="flex flex-col gap-4 border-b border-[var(--color-hairline)] py-5 last:border-0 sm:flex-row sm:items-center sm:gap-6">
      {/* ------------------------------------------------------------ identity */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <TokenMark symbol={asset.symbol} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-medium text-[var(--color-primary)]">
              {underlyingSymbol}
            </span>
            {isVaultAsset ? <Badge tone="accent">Sable accepts</Badge> : null}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-[var(--color-tertiary)]">{asset.name}</p>
        </div>
      </div>

      {/* -------------------------------------------------------------- public */}
      <div className="sm:w-[150px] sm:text-right">
        <p className="text-eyebrow mb-1.5">Public</p>
        <p className="text-numeric text-[14px] text-[var(--color-primary)]">
          {formatTokenAmount(publicBalance, asset.underlyingDecimals)}
        </p>
      </div>

      {/* ------------------------------------------------------------ shielded */}
      <div className="sm:w-[190px]">
        <p className="text-eyebrow mb-1.5 sm:text-right">Shielded</p>
        {/*
          `min-w-0` so this can never push into the public column beside it. The revealing
          state is wider than the masked one, and a fixed-width cell with `justify-end`
          overflows leftwards rather than clipping — which put the mask on top of the public
          balance instead of simply running out of room.
        */}
        <div className="flex min-w-0 items-center gap-3 sm:justify-end">
          {/*
            No currency prefix: these wrappers are not all dollar-denominated, and a `$`
            against a shielded WETH balance would misstate the unit. The row already names
            the token.
          */}
          <ConfidentialValue
            state={reveal.state}
            value={shielded}
            error={reveal.error}
            size="sm"
            currency={false}
            /*
             * The button beside this already reads "Working…", so the phrase would be both
             * redundant and the thing that breaks the layout. Screen readers still get it.
             */
            showStatus={false}
          />
          <RevealButton
            state={reveal.state}
            onReveal={reveal.reveal}
            onHide={reveal.hide}
            labelReveal="Reveal"
            labelHide="Hide"
          />
        </div>
      </div>

      {/* ---------------------------------------------------------------- action */}
      <div className="shrink-0 sm:w-[92px] sm:text-right">
        {publicBalance > 0n ? (
          <Link
            href={`/app/deposit/shield?asset=${asset.address}`}
            className="text-[12px] text-[var(--color-accent)] transition-opacity hover:opacity-75"
          >
            Shield →
          </Link>
        ) : (
          <span className="text-[12px] text-[var(--color-quaternary)]">—</span>
        )}
      </div>
    </div>
  );
}
