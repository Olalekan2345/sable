"use client";

import {
  assetSymbol,
  addresses,
  deployment,
  findZamaAsset,
  floorToRate,
  formatAmount,
  isWrappedAsset,
  wrappedAmountFor,
} from "@sable/config";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { ConnectPrompt } from "@/components/app/connect-prompt";
import { DepositSteps } from "@/components/app/deposit-steps";
import { FaucetCard } from "@/components/app/faucet-card";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  Card,
  DataRow,
  ExplorerLink,
  PageHeader,
  PrivacyNote,
  Skeleton,
} from "@/components/ui/primitives";
import { ErrorNotice } from "@/components/ui/error-notice";
import {
  TokenAmountInput,
  formatTokenAmount,
  validateTokenAmount,
} from "@/components/ui/token-amount-input";
import { useToast } from "@/components/ui/toast";
import { useAssetContract, useWalletBalanceHandle } from "@/lib/hooks/use-sable";
import {
  useUnderlyingBalance,
  useWrap,
  useWrapperInfo,
  wrapperBlockReason,
} from "@/lib/hooks/use-wrapper";

const WRAP_STAGE_COPY = {
  approving: "Approving the wrapper to move your tokens…",
  wrapping: "Converting into the confidential token…",
} as const;

/**
 * Shield — the crossing from the public token economy into the confidential one.
 *
 * Sable custodies Zama's published confidential token and issues nothing of its own, so
 * wrapping is the *only* way value enters the confidential side. That makes this a first
 * step rather than a side feature, and it gets a page of its own with a real amount field:
 * shielding a whole wallet balance is rarely what anyone actually wants.
 *
 * ## The honest part
 *
 * `wrap(to, amount)` takes a **cleartext** amount. Shielding does not hide how much you
 * shielded — that figure sits in the calldata for anyone to read, as does the `approve`
 * before it. What it buys is confidentiality from that point on: the resulting balance, every
 * transfer of it, and the deposit into Sable are all encrypted.
 *
 * Saying so on this page costs a little of the magic and is not optional. A saver who
 * believes this step is private might shield an amount they would not otherwise reveal.
 */
function ShieldView() {
  const { isConnected } = useAccount();
  const { notify } = useToast();

  /**
   * Which asset is being shielded.
   *
   * `?asset=` lets the holdings view send a saver straight here for any of Zama's published
   * tokens. It is matched against the known registry rather than trusted: an arbitrary
   * address in a URL must not become a contract this page asks a wallet to approve.
   */
  const requested = useSearchParams().get("asset");
  const selected = findZamaAsset(requested);
  const wrapper = selected?.address ?? addresses.asset ?? undefined;

  const vaultAsset = useAssetContract();
  const info = useWrapperInfo(wrapper);
  const { balance, refetch: refetchUnderlying } = useUnderlyingBalance(info.underlying);
  const { refetch: refetchWallet } = useWalletBalanceHandle();
  const { wrap, stage, error, isBusy } = useWrap(wrapper);

  const [amount, setAmount] = useState("");

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

  if (!isConnected) {
    return (
      <ConnectPrompt
        title="Connect to shield tokens"
        description="Shielding converts a public token you already hold into the confidential form Sable accepts. Connect a wallet to begin."
      />
    );
  }

  const symbol = selected?.symbol ?? assetSymbol();
  const uSymbol = (underlyingSymbol as string | undefined) ?? "the public token";
  // Prefer the value read from the chain; fall back to the registry while it loads.
  const decimals = Number(
    underlyingDecimals ?? selected?.underlyingDecimals ?? deployment?.asset.underlyingDecimals ?? 6,
  );
  const isVaultAsset = wrapper?.toLowerCase() === vaultAsset.address?.toLowerCase();

  // A local development deployment issues its own asset and has no wrapper to shield through.
  if (!wrapper || (!selected && (!isWrappedAsset() || !vaultAsset.address))) {
    return (
      <>
        <PageHeader
          eyebrow="Deposit"
          title="Shield"
          description="Convert a public token into the confidential form Sable accepts."
        />
        <Card className="p-7 sm:p-8">
          <p className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
            This deployment uses a locally issued confidential asset rather than one of Zama&rsquo;s
            wrapped tokens, so there is nothing to shield — the asset is already confidential.
          </p>
          <div className="mt-6">
            <ButtonLink href="/app/deposit" size="md" variant="secondary">
              Go to deposit
            </ButtonLink>
          </div>
        </Card>
      </>
    );
  }

  const { amount: parsed, error: amountError } = validateTokenAmount(amount, {
    decimals,
    max: balance,
    maxMessage: `That is more than the ${formatTokenAmount(balance, decimals)} ${uSymbol} in your wallet.`,
  });

  // The wrapper converts in whole multiples of `rate` and refunds any remainder. Showing the
  // exact figure beats letting a refund arrive later as unexplained dust.
  const wrappable = parsed ? floorToRate(parsed, info.rate) : 0n;
  const remainder = parsed ? parsed - wrappable : 0n;
  const received = wrappedAmountFor(wrappable, info.rate);

  const blockedReason = wrapperBlockReason(info);
  const holdsNothing = balance === 0n;
  const belowSmallestUnit = Boolean(parsed) && wrappable === 0n;

  const onShield = async () => {
    if (!info.underlying || !parsed) return;

    const hash = await wrap(info.underlying, parsed, info.rate);
    if (hash) {
      notify({
        title: `Shielded into ${symbol}`,
        description: "Your balance is confidential from here on — encrypted like any other.",
        tone: "verified",
        txHash: hash,
      });
      setAmount("");
      await Promise.all([refetchWallet(), refetchUnderlying()]);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Deposit"
        title="Shield your tokens"
        description={`Convert public ${uSymbol} into ${symbol}, the confidential token Sable accepts. You choose how much crosses over.`}
      />

      <DepositSteps className="mb-6" />

      <div className="flex flex-col gap-4">
        {/*
          Shielding works for every asset Zama publishes; saving does not. The vault takes a
          single ERC-7984 in its constructor, so pretending otherwise here would lead someone
          through two transactions to a deposit screen that cannot accept the result.
        */}
        {!isVaultAsset ? (
          <Card className="border-[var(--color-hairline-accent)] p-5">
            <p className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
              You can shield {uSymbol} and hold it confidentially, but{" "}
              <span className="text-[var(--color-primary)]">
                this deployment&rsquo;s vault does not accept {symbol}
              </span>{" "}
              — it custodies{" "}
              {assetSymbol()} only, so shielded {symbol} cannot be
              deposited to earn.
            </p>
          </Card>
        ) : null}
        <Card className="p-7 sm:p-9">
          {/* Public balance. Stated as public, because it is — no reveal, nothing hidden. */}
          <div className="mb-7 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-eyebrow">In your wallet</p>
              <p className="text-numeric mt-2.5 text-[22px] font-medium text-[var(--color-primary)]">
                {formatTokenAmount(balance, decimals)}{" "}
                <span className="text-[13px] font-normal text-[var(--color-tertiary)]">
                  {uSymbol}
                </span>
              </p>
            </div>
            <p className="shrink-0 text-right text-[11px] leading-relaxed text-[var(--color-quaternary)]">
              Public balance
              <br />
              visible to anyone
            </p>
          </div>

          {blockedReason ? (
            <p className="text-[13px] leading-relaxed text-[var(--color-caution)]">{blockedReason}</p>
          ) : holdsNothing ? (
            <div>
              <p className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
                You have no {uSymbol} in this wallet yet.
              </p>

              <FaucetCard
                className="mt-4"
                onClaimed={async () => {
                  await refetchUnderlying();
                }}
              />

              <p className="mt-4 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
                Already holding {symbol}? Skip this step and go straight to the deposit.
              </p>
              <div className="mt-4">
                <ButtonLink href="/app/deposit" size="sm" variant="secondary">
                  Go to deposit
                </ButtonLink>
              </div>
            </div>
          ) : (
            <>
              <TokenAmountInput
                label={`Amount to shield`}
                value={amount}
                onChange={setAmount}
                decimals={decimals}
                symbol={uSymbol}
                max={balance}
                error={amountError}
                disabled={isBusy}
              />

              <dl className="mt-6">
                <DataRow label="You receive">
                  <span className="text-numeric">
                    {formatAmount(received)} {symbol}
                  </span>
                </DataRow>

                {remainder > 0n ? (
                  <DataRow label="Not shielded" hint="below the wrapper's smallest unit">
                    <span className="text-numeric text-[var(--color-caution)]">
                      {formatTokenAmount(remainder, decimals)} {uSymbol}
                    </span>
                  </DataRow>
                ) : null}

                <DataRow label="Transactions" hint="approve, then wrap">
                  <span className="text-numeric">2</span>
                </DataRow>
              </dl>

              {belowSmallestUnit ? (
                <p className="mt-4 text-[12px] leading-relaxed text-[var(--color-caution)]">
                  That is smaller than the wrapper&rsquo;s smallest convertible unit, so nothing
                  would be shielded.
                </p>
              ) : null}

              <div className="mt-6">
                <Button
                  size="lg"
                  fullWidth
                  onClick={onShield}
                  loading={isBusy}
                  disabled={!parsed || Boolean(amountError) || belowSmallestUnit}
                >
                  Shield into {symbol}
                </Button>
              </div>

              {isBusy && stage !== "idle" ? (
                <p role="status" className="mt-4 text-[12px] text-[var(--color-accent)]">
                  {WRAP_STAGE_COPY[stage]}
                </p>
              ) : null}

              {error ? <ErrorNotice message={error} className="mt-4" /> : null}

              {/*
                The one claim this page must not overstate. See the file comment: the wrapped
                amount is cleartext in the calldata, so shielding is not itself private.
              */}
              <PrivacyNote className="mt-6 items-start">
                <span>
                  Shielding is public — the amount appears in the transaction. What it buys is
                  everything after: your {symbol} balance, your deposit and your yield mode are
                  all encrypted. Shielding a round number and immediately depositing all of it
                  is the one pattern that leaks an upper bound, so shield in advance, or shield
                  more than you plan to deposit.
                </span>
              </PrivacyNote>
            </>
          )}

          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--color-hairline)] pt-5">
            <ExplorerLink address={wrapper} label={`${symbol} contract ↗`} />
            {info.underlying ? (
              <ExplorerLink address={info.underlying} label={`${uSymbol} contract ↗`} />
            ) : null}
          </div>
        </Card>

        <p className="text-[12px] leading-relaxed text-[var(--color-tertiary)]">
          Already shielded?{" "}
          <Link
            href="/app/deposit"
            className="text-[var(--color-accent)] transition-opacity hover:opacity-75"
          >
            Continue to the deposit
          </Link>{" "}
          to move your {symbol} into the vault.
        </p>
      </div>
    </>
  );
}

/**
 * `useSearchParams` opts a route into client rendering, and Next requires the boundary to be
 * explicit so the rest of the page can still be prerendered around it.
 */
export default function ShieldPage() {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader
            eyebrow="Deposit"
            title="Shield your tokens"
            description="Convert a public token into the confidential form Sable accepts."
          />
          <Skeleton className="h-[340px] w-full" />
        </>
      }
    >
      <ShieldView />
    </Suspense>
  );
}
