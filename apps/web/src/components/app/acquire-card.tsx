"use client";

import { assetSymbol, deployment, isWrappedAsset, floorToRate } from "@sable/config";
import { erc20Abi } from "viem";
import { useReadContract } from "wagmi";

import { ButtonLink } from "@/components/ui/button";
import { FaucetCard } from "@/components/app/faucet-card";
import { Card, ExplorerLink } from "@/components/ui/primitives";
import { formatTokenAmount } from "@/components/ui/token-amount-input";
import { cn } from "@/lib/cn";
import { useAssetContract } from "@/lib/hooks/use-sable";
import { useUnderlyingBalance, useWrapperInfo } from "@/lib/hooks/use-wrapper";

/**
 * A pointer to the shielding step, shown on the deposit page.
 *
 * Sable custodies Zama's published confidential token and issues nothing of its own, so a
 * wallet arriving empty needs two things: the underlying ERC-20, and a way to convert it. The
 * first comes from {FaucetCard}, which calls the public mint on *Zama's* token; the second is
 * **shielding**, which wraps it into the confidential form the vault accepts.
 *
 * The conversion itself lives on `/app/deposit/shield`, where it has room for an amount
 * field. This card used to perform the wrap inline, with one button that converted the
 * saver's entire balance — which is rarely what anyone wants, and gave no way to say
 * otherwise. It now only notices the situation and points at the page that handles it.
 */
export function AcquireAssetCard({ className }: { className?: string }) {
  const asset = useAssetContract();
  const info = useWrapperInfo();
  const { balance, refetch: refetchUnderlying } = useUnderlyingBalance(info.underlying);

  const { data: underlyingSymbol } = useReadContract({
    address: info.underlying,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: Boolean(info.underlying) },
  });

  const { data: underlyingDecimals } = useReadContract({
    address: info.underlying,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: Boolean(info.underlying) },
  });

  // A local development deployment issues its own asset; acquiring it is a CLI concern and
  // the app should not grow a button for it.
  if (!isWrappedAsset() || !asset.address) return null;

  const symbol = assetSymbol();
  const uSymbol = (underlyingSymbol as string | undefined) ?? "the underlying token";
  const decimals = Number(underlyingDecimals ?? deployment?.asset.underlyingDecimals ?? 6);

  const shieldable = floorToRate(balance, info.rate);
  const holdsUnderlying = shieldable > 0n;

  return (
    <Card className={cn("p-6", className)}>
      <p className="text-eyebrow mb-3">The asset Sable accepts</p>

      {holdsUnderlying ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-[13px] leading-relaxed text-[var(--color-secondary)]">
            You hold{" "}
            <span className="text-numeric text-[var(--color-primary)]">
              {formatTokenAmount(shieldable, decimals)} {uSymbol}
            </span>
            . Shield as much of it as you want to get {symbol}, the confidential form Sable
            custodies.
          </p>

          <ButtonLink
            href="/app/deposit/shield"
            size="sm"
            variant="secondary"
            className="shrink-0"
          >
            Shield {uSymbol}
          </ButtonLink>
        </div>
      ) : (
        <div>
          <p className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
            Sable accepts <span className="text-[var(--color-primary)]">{symbol}</span>,
            Zama&rsquo;s published confidential token. Start by obtaining the public token it
            wraps, then shield it.
          </p>

          <FaucetCard
            className="mt-4"
            onClaimed={async () => {
              await refetchUnderlying();
            }}
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
        <ExplorerLink address={asset.address} label={`${symbol} contract ↗`} />
        {info.underlying ? (
          <ExplorerLink address={info.underlying} label={`${uSymbol} contract ↗`} />
        ) : null}
      </div>
    </Card>
  );
}
