"use client";

import {
  HCU_BUDGET,
  ROUND_STATE_LABELS,
  RoundState,
  addresses,
  formatTimestamp,
} from "@sable/config";
import { useAccount } from "wagmi";

import { TransactionStatus } from "@/components/app/transaction-status";
import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardHeader,
  DataRow,
  EmptyState,
  ExplorerLink,
  PageHeader,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useConfidentialTx } from "@/lib/hooks/use-confidential-tx";
import { useActiveRound, useAllRounds } from "@/lib/hooks/use-rounds";
import { useProtocolState } from "@/lib/hooks/use-sable";

/**
 * Operator dashboard.
 *
 * Shows protocol state and drives the round lifecycle. It deliberately shows **no user
 * data at all** — no balances, no modes, no ticket ranges — because an operator holds no
 * permission over any of it and a dashboard implying otherwise would misrepresent the
 * trust model.
 *
 * Every control here performs a real transaction. Actions unavailable in the current state
 * are disabled with the reason shown, rather than being present but inert.
 */
export default function AdminPage() {
  const { isConnected } = useAccount();
  const { notify } = useToast();

  const protocol = useProtocolState();
  const { round: activeRound, refetch: refetchRound } = useActiveRound();
  const { rounds } = useAllRounds();
  const tx = useConfidentialTx();

  /*
   * No role is read here, because none gates the controls below.
   *
   * This page used to check `OPERATOR_ROLE` and render the lifecycle read-only for anybody
   * who lacked it. Round advancement is now permissionless — `openRound`, `closeRound`, the
   * eligibility, ticket, draw and settlement batches and `completeRound` check nothing — so
   * that check told connected wallets they could not do something they could. The role
   * constant still exists in the deployed contract and is still granted to the deployer; it
   * simply guards nothing, and a UI gate built on it is a lie about the access control.
   *
   * `configureRound` remains admin-only, and the transaction reverts on its own for anybody
   * else. Guessing at that in the client would risk the opposite error.
   */

  const latest = activeRound ?? rounds[0] ?? null;

  const run = async (fn: string, args: readonly unknown[], label: string) => {
    const hash = await tx.sendPlain(fn, args);
    if (hash) {
      notify({ title: label, tone: "verified", txHash: hash });
      await Promise.all([refetchRound(), protocol.refetch()]);
    }
  };

  return (
    <>
      <SiteHeader />

      <main id="main" className="mx-auto max-w-[880px] px-5 pb-24 pt-28 sm:px-8">
        <PageHeader
          eyebrow="Operations"
          title="Protocol dashboard"
          description="Round lifecycle and deployment state. No participant data appears here — operators hold no permission over it."
        />

        {!addresses.sable ? (
          <Card>
            <EmptyState
              title="Not deployed"
              description="Deploy the contracts and run the ABI sync to populate this dashboard."
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {/* ------------------------------------------------- Deployment */}
            <Card className="p-7 sm:p-8">
              <CardHeader eyebrow="Deployment" title="Contracts" />
              <dl className="mt-6">
                <DataRow label="Vault">
                  <ExplorerLink address={addresses.sable} />
                </DataRow>
                {addresses.asset ? (
                  <DataRow label="Confidential asset">
                    <ExplorerLink address={addresses.asset} />
                  </DataRow>
                ) : null}
                {addresses.yieldAdapter ? (
                  <DataRow label="Yield adapter">
                    <ExplorerLink address={addresses.yieldAdapter} />
                  </DataRow>
                ) : null}
                <DataRow label="Participants">
                  <span className="text-numeric">
                    {protocol.participantCount.toString()} / {protocol.participantCap}
                  </span>
                </DataRow>
                <DataRow label="Published yield rate">
                  {protocol.ratePerYearBps !== null
                    ? `${Number(protocol.ratePerYearBps) / 100}% per year`
                    : "—"}
                </DataRow>
                <DataRow label="Status">
                  <Badge tone={protocol.paused ? "caution" : "verified"} dot>
                    {protocol.paused ? "Paused" : "Live"}
                  </Badge>
                </DataRow>
              </dl>
            </Card>

            {/* ---------------------------------------------------- Round */}
            {latest ? (
              <Card className="p-7 sm:p-8">
                <CardHeader
                  eyebrow={`Round #${latest.id}`}
                  title={ROUND_STATE_LABELS[latest.lifecycle.state]}
                  action={<Badge tone="accent">{latest.lifecycle.participantCount} scored</Badge>}
                />

                <dl className="mt-6">
                  <DataRow label="Opens">{formatTimestamp(latest.config.opensAt)}</DataRow>
                  <DataRow label="Closes">{formatTimestamp(latest.config.closesAt)}</DataRow>
                  <DataRow label="Eligibility">
                    <Progress
                      done={latest.lifecycle.eligibilityCursor}
                      total={latest.lifecycle.participantCount}
                    />
                  </DataRow>
                  <DataRow label="Tickets">
                    <Progress
                      done={latest.lifecycle.ticketCursor}
                      total={latest.lifecycle.participantCount}
                    />
                  </DataRow>
                  <DataRow label="Draw points">
                    <Progress
                      done={latest.lifecycle.drawCursor}
                      total={latest.lifecycle.drawPointCount}
                    />
                  </DataRow>
                  <DataRow label="Settlement">
                    <Progress
                      done={Number(latest.lifecycle.settleCursor)}
                      total={latest.lifecycle.participantCount}
                    />
                  </DataRow>
                </dl>

                {!isConnected ? (
                  <p className="mt-6 text-[13px] text-[var(--color-tertiary)]">
                    Connect any wallet with gas to advance the round. No role is required.
                  </p>
                ) : (
                  <>
                    <div className="rule-fade my-7" />

                    <p className="text-eyebrow mb-4">Lifecycle</p>

                    <div className="flex flex-wrap gap-2.5">
                      <Action
                        label="Open round"
                        enabled={latest.lifecycle.state === RoundState.Scheduled}
                        busy={tx.isBusy}
                        onClick={() => run("openRound", [BigInt(latest.id)], "Round opened")}
                      />
                      <Action
                        label="Close round"
                        enabled={latest.lifecycle.state === RoundState.Open}
                        busy={tx.isBusy}
                        onClick={() => run("closeRound", [BigInt(latest.id)], "Round closed")}
                      />
                      <Action
                        label={`Eligibility batch (${HCU_BUDGET.batchDefaults.eligibility})`}
                        enabled={
                          latest.lifecycle.state === RoundState.Closing &&
                          latest.lifecycle.eligibilityCursor < latest.lifecycle.participantCount
                        }
                        busy={tx.isBusy}
                        onClick={() =>
                          run(
                            "processEligibilityBatch",
                            [BigInt(latest.id), HCU_BUDGET.batchDefaults.eligibility],
                            "Eligibility advanced",
                          )
                        }
                      />
                      <Action
                        label="Finalize"
                        enabled={
                          latest.lifecycle.state === RoundState.Closing &&
                          latest.lifecycle.eligibilityCursor >= latest.lifecycle.participantCount
                        }
                        busy={tx.isBusy}
                        onClick={() => run("finalizeRound", [BigInt(latest.id)], "Round finalized")}
                      />
                      <Action
                        label={`Ticket batch (${HCU_BUDGET.batchDefaults.tickets})`}
                        enabled={latest.lifecycle.state === RoundState.Finalized}
                        busy={tx.isBusy}
                        onClick={() =>
                          run(
                            "assignTicketsBatch",
                            [BigInt(latest.id), HCU_BUDGET.batchDefaults.tickets],
                            "Tickets assigned",
                          )
                        }
                      />
                      <Action
                        label={`Draw batch (${HCU_BUDGET.batchDefaults.draw})`}
                        enabled={latest.lifecycle.state === RoundState.Drawing}
                        busy={tx.isBusy}
                        onClick={() =>
                          run(
                            "drawBatch",
                            [BigInt(latest.id), HCU_BUDGET.batchDefaults.draw],
                            "Draw points generated",
                          )
                        }
                      />
                      <Action
                        label={`Settle batch (${HCU_BUDGET.batchDefaults.settle})`}
                        enabled={
                          latest.lifecycle.state === RoundState.Settling &&
                          Number(latest.lifecycle.settleCursor) < latest.lifecycle.participantCount
                        }
                        busy={tx.isBusy}
                        onClick={() =>
                          run(
                            "settleBatch",
                            [BigInt(latest.id), HCU_BUDGET.batchDefaults.settle],
                            "Settlement advanced",
                          )
                        }
                      />
                      <Action
                        label="Complete round"
                        enabled={
                          latest.lifecycle.state === RoundState.Settling &&
                          Number(latest.lifecycle.settleCursor) >= latest.lifecycle.participantCount
                        }
                        busy={tx.isBusy}
                        onClick={() => run("completeRound", [BigInt(latest.id)], "Round completed")}
                      />
                    </div>

                    <p className="mt-5 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
                      Batch sizes are set from measured homomorphic cost against the 20M unit
                      per-transaction ceiling. Settlement is capped at{" "}
                      {HCU_BUDGET.batchDefaults.settle} accounts because the fourteen-point ladder
                      costs about 7.56M units per account.
                    </p>

                    <TransactionStatus
                      stage={tx.stage}
                      error={tx.error} detail={tx.detail}
                      txHash={tx.txHash}
                      className="mt-6"
                    />
                  </>
                )}
              </Card>
            ) : (
              <Card>
                <EmptyState
                  title="No rounds configured"
                  description="Configure the first round with the contracts package: pnpm --filter @sable/contracts exec hardhat round:configure --network sepolia"
                />
              </Card>
            )}
          </div>
        )}
      </main>

      <SiteFooter />
    </>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const complete = total > 0 && done >= total;
  return (
    <span className={complete ? "text-[var(--color-verified)]" : "text-[var(--color-secondary)]"}>
      <span className="text-numeric font-mono">
        {done}/{total}
      </span>
    </span>
  );
}

/** A lifecycle control. Disabled when the state machine does not permit it — never inert. */
function Action({
  label,
  enabled,
  busy,
  onClick,
}: {
  label: string;
  enabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={enabled ? "secondary" : "ghost"}
      disabled={!enabled || busy}
      onClick={onClick}
      title={enabled ? undefined : "Not available in the current round state"}
    >
      {label}
    </Button>
  );
}
