"use client";

import { assetSymbol, deployment, formatTimestamp } from "@sable/config";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";

import { ConnectPrompt } from "@/components/app/connect-prompt";
import {
  Badge,
  Card,
  EmptyState,
  ExplorerLink,
  PageHeader,
  PrivacyNote,
  Skeleton,
} from "@/components/ui/primitives";
import { ButtonLink } from "@/components/ui/button";
import { ACTIVITY_LABELS, useActivity } from "@/lib/hooks/use-activity";

/**
 * Private activity.
 *
 * Every row is a real transaction from the connected wallet, read straight from chain logs
 * across all three contracts a saver touches: the public token, the confidential asset and
 * the vault.
 *
 * Each row is marked **public** or **private**, which is more useful than showing only the
 * encrypted half and more honest than implying the whole history is hidden. Obtaining tokens,
 * approving the wrapper, shielding and unwrapping all publish real figures — those are shown.
 * Balances, deposits, withdrawals and mode changes do not, and never will.
 */
export default function ActivityPage() {
  const { isConnected } = useAccount();
  const { data, isLoading, error } = useActivity();

  const entries = data?.entries ?? [];

  if (!isConnected) {
    return (
      <ConnectPrompt
        title="Connect to see your activity"
        description="Sable reconstructs your history from public transaction logs, scoped to your address. Nothing is sent to a server."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Activity"
        title="Your private history"
        description="Everything this wallet has done with Sable, across all three contracts. Each entry is marked public or private — the private ones carry no amount in their logs at all."
      />

      {/*
        A partial result is reported rather than quietly shown as a shorter list. An activity
        view that silently drops rows is worse than one that admits it could not read them all:
        the saver has no way to tell the difference between "nothing happened" and "the node
        refused the query".
      */}
      {data?.partial ? (
        <div
          role="status"
          className="mb-4 rounded-[var(--radius-md)] border border-[rgba(240,165,0,0.26)] bg-[rgba(240,165,0,0.05)] p-4"
        >
          <p className="text-[13px] text-[var(--color-caution)]">
            Some log queries were rejected, so this history may be incomplete. Configure a
            dedicated RPC endpoint in <code>NEXT_PUBLIC_RPC_URL</code> for a reliable timeline.
          </p>
        </div>
      ) : null}

      {data?.truncated ? (
        <div role="status" className="mb-4 surface-inset p-4">
          <p className="text-[13px] text-[var(--color-secondary)]">
            Showing recent history only — the full range is longer than a public endpoint will
            serve.
          </p>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col gap-4 p-7">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center justify-between gap-6">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState
            title="Could not load activity"
            description="The RPC endpoint rejected the log query. This is usually a rate limit — try again shortly."
          />
        ) : entries.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Your shielding, deposits, withdrawals and mode changes will appear here."
            action={
              <ButtonLink href="/app/deposit" size="md">
                Make a deposit
              </ButtonLink>
            }
          />
        ) : (
          <ul>
            {entries.map((entry) => {
              const copy = ACTIVITY_LABELS[entry.kind];
              return (
                <li
                  key={`${entry.txHash}-${entry.logIndex}`}
                  className="flex flex-col gap-3 border-b border-[var(--color-hairline)] px-7 py-5 last:border-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <p className="text-[14px] font-medium text-[var(--color-primary)]">
                        {copy.title}
                      </p>
                      {/*
                        Marked on every row rather than inferred from whether a figure is
                        present. "No amount shown" and "this amount is encrypted" are
                        different statements, and only one of them is true here.
                      */}
                      <Badge tone={entry.visibility === "public" ? "neutral" : "accent"}>
                        {entry.visibility === "public" ? "Public" : "Private"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[12px] text-[var(--color-tertiary)]">
                      {entry.timestamp ? formatTimestamp(entry.timestamp) : "—"}
                      <span className="mx-2 text-[var(--color-quaternary)]">·</span>
                      {copy.detail}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    {entry.amount !== undefined ? (
                      <span className="text-numeric text-[13px] text-[var(--color-primary)]">
                        {formatUnits(entry.amount, entry.decimals ?? 6)}{" "}
                        <span className="text-[var(--color-tertiary)]">
                          {symbolFor(entry.kind)}
                        </span>
                      </span>
                    ) : (
                      // "Encrypted" is only true of a private row. A public action with no
                      // amount — registering, granting an operator — has nothing hidden about
                      // it, and saying otherwise would overstate what the protocol conceals.
                      <span className="text-[12px] text-[var(--color-quaternary)]">
                        {entry.visibility === "private" ? "Encrypted" : "—"}
                      </span>
                    )}

                    <ExplorerLink hash={entry.txHash} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <PrivacyNote className="mt-6 items-start">
        <span>
          Rows marked <strong className="text-[var(--color-primary)]">Private</strong> carry no
          amount in their logs — Sable&rsquo;s events contain an address and nothing else, so no
          figure could be shown even if one were wanted. Rows marked{" "}
          <strong className="text-[var(--color-primary)]">Public</strong> are ordinary on-chain
          movements: obtaining tokens, approving the wrapper, and the two moments value crosses
          the confidential boundary.
        </span>
      </PrivacyNote>
    </>
  );
}

/** Underlying-denominated rows are in the public token; the rest are in the confidential one. */
function symbolFor(kind: string): string {
  const underlying = deployment?.asset.symbol.replace(/^c/, "") ?? "tokens";
  return kind === "tokensReceived" || kind === "tokensSent" || kind === "approved" || kind === "shield"
    ? underlying
    : assetSymbol();
}
