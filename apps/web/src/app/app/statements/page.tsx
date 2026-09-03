"use client";

import { addresses } from "@sable/config";
import { useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";

import { ConnectPrompt } from "@/components/app/connect-prompt";
import { Button } from "@/components/ui/button";
import { Card, DataRow, PageHeader, PrivacyNote } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { ACTIVITY_LABELS, useActivity } from "@/lib/hooks/use-activity";
import { useRevealMany } from "@/lib/hooks/use-reveal";
import { usePositionHandles } from "@/lib/hooks/use-sable";
import { generateStatementPdf, type StatementMovement } from "@/lib/statement";

/** The last twelve months, newest first. */
function recentMonths(count = 12): { label: string; start: Date; end: Date }[] {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59));
    return {
      label: start.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
      start,
      end,
    };
  });
}

/**
 * Private statements.
 *
 * The statement is assembled and rendered entirely in the browser: public logs give the
 * dated movements, the saver's own decryption gives the closing position, and jsPDF puts
 * them on a page. No decrypted figure is transmitted anywhere.
 */
export default function StatementsPage() {
  const { isConnected, address } = useAccount();
  const client = usePublicClient();
  const { notify } = useToast();

  const { balanceHandle, rewardHandle } = usePositionHandles();
  const { data: activity } = useActivity();
  const movementsOnRecord = activity?.entries;

  const months = useMemo(() => recentMonths(), []);
  const [selected, setSelected] = useState(0);
  const [building, setBuilding] = useState(false);

  const reveal = useRevealMany(
    { balance: balanceHandle, reward: rewardHandle },
    addresses.sable ?? undefined,
  );

  const period = months[selected]!;

  if (!isConnected) {
    return (
      <ConnectPrompt
        title="Connect to generate a statement"
        description="A statement needs your authorisation to decrypt your own position. It is built locally and never uploaded."
      />
    );
  }

  const download = async () => {
    if (!address || !client) return;

    setBuilding(true);
    try {
      const entries = activity?.entries ?? [];
      const movements: StatementMovement[] = [];

      for (const entry of entries) {
        // The hook resolves timestamps for the rows it shows; fall back to the block for any
        // older movement that a statement reaches but the timeline did not render.
        const seconds =
          entry.timestamp ??
          Number((await client.getBlock({ blockNumber: entry.blockNumber })).timestamp);
        const date = new Date(seconds * 1000);
        if (date < period.start || date > period.end) continue;

        movements.push({
          date,
          description: ACTIVITY_LABELS[entry.kind].title,
          txHash: entry.txHash,
        });
      }

      movements.sort((a, b) => a.date.getTime() - b.date.getTime());

      const balance = reveal.values?.balance;
      const reward = reveal.values?.reward;

      await generateStatementPdf({
        account: address,
        periodStart: period.start,
        periodEnd: period.end,
        generatedAt: new Date(),
        closingPosition: typeof balance === "bigint" ? balance : null,
        unclaimedRewards: typeof reward === "bigint" ? reward : null,
        movements,
      });

      notify({
        title: "Statement downloaded",
        description: "Generated locally. Nothing was uploaded.",
        tone: "verified",
      });
    } catch {
      notify({
        title: "Could not build the statement",
        description: "Reading block timestamps failed. Try again in a moment.",
        tone: "danger",
      });
    } finally {
      setBuilding(false);
    }
  };

  const authorized = reveal.state === "revealed";

  return (
    <>
      <PageHeader
        eyebrow="Statements"
        title="Private savings statement"
        description="A dated record of your activity and your current position, generated in your browser."
      />

      <div className="flex flex-col gap-4">
        <Card className="p-7 sm:p-8">
          <p className="text-eyebrow mb-4">Statement period</p>

          <div className="flex flex-wrap gap-2">
            {months.slice(0, 6).map((month, index) => (
              <button
                key={month.label}
                type="button"
                onClick={() => setSelected(index)}
                aria-pressed={selected === index}
                className={cn(
                  "rounded-full border px-3.5 py-2 text-[12px] transition-colors",
                  selected === index
                    ? "border-[var(--color-hairline-accent)] bg-[var(--color-elevated)] text-[var(--color-primary)]"
                    : "border-[var(--color-hairline)] text-[var(--color-tertiary)] hover:text-[var(--color-primary)]",
                )}
              >
                {month.label}
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-7 sm:p-8">
          <p className="text-eyebrow mb-5">Included in this statement</p>

          <dl>
            <DataRow label="Account">
              <span className="font-mono text-[12px]">{address}</span>
            </DataRow>
            <DataRow label="Period">{period.label}</DataRow>
            <DataRow label="Closing position">
              {authorized ? "Included" : "Requires authorisation"}
            </DataRow>
            <DataRow label="Movements">
              {movementsOnRecord ? `${movementsOnRecord.length} on record` : "Loading"}
            </DataRow>
          </dl>

          <div className="surface-inset mt-6 p-5">
            <p className="text-[12px] leading-relaxed text-[var(--color-tertiary)]">
              Per-transaction amounts cannot be shown. Each confidential operation produces a new
              ciphertext, and Sable retains no decryption rights over superseded ones — so past
              amounts are unreadable to everyone, including you. The statement reports the
              movements that occurred and your position as at generation time.
            </p>
          </div>

          <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
            {!authorized ? (
              <Button
                size="lg"
                onClick={reveal.reveal}
                loading={reveal.state === "authorizing" || reveal.state === "decrypting"}
                className="flex-1"
              >
                Authorise and prepare
              </Button>
            ) : (
              <Button size="lg" onClick={download} loading={building} className="flex-1">
                Download PDF
              </Button>
            )}
          </div>

          {reveal.error ? (
            <p role="alert" className="mt-4 text-[13px] text-[var(--color-danger)]">
              {reveal.error}
            </p>
          ) : null}

          <PrivacyNote className="mt-6">
            Built entirely in your browser. No decrypted value is sent to any server.
          </PrivacyNote>
        </Card>
      </div>
    </>
  );
}
