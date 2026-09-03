"use client";

import { addresses } from "@sable/config";
import { motion } from "motion/react";
import { useState } from "react";
import { useAccount } from "wagmi";

import { ConnectPrompt } from "@/components/app/connect-prompt";
import { TransactionStatus } from "@/components/app/transaction-status";
import { Button } from "@/components/ui/button";
import { ConfidentialValue, RevealButton } from "@/components/ui/confidential-value";
import { Card, PageHeader, PrivacyNote } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { useConfidentialTx } from "@/lib/hooks/use-confidential-tx";
import { useReveal } from "@/lib/hooks/use-reveal";
import { usePositionHandles } from "@/lib/hooks/use-sable";

/**
 * The yield-mode page.
 *
 * Sable's signature interaction. The control is a single sliding switch producing a single
 * encrypted transaction — there is no `enableLucky()` and no `enableSteady()`, because two
 * public functions would publish the choice through the function selector alone.
 *
 * The current mode is not assumed from local state after a reload. It is read from the
 * chain as a ciphertext and stays unknown to the page until the saver decrypts it.
 */
export default function ModePage() {
  const { isConnected } = useAccount();
  const { modeHandle, refetch } = usePositionHandles();
  const { notify } = useToast();

  const reveal = useReveal(modeHandle, {
    contractAddress: addresses.sable ?? undefined,
    kind: "bool",
  });
  const tx = useConfidentialTx();

  // Only the saver's own pick is stored. Until they make one, the control follows the
  // revealed mode and is derived rather than copied into state — an effect that copied it
  // rendered "Steady" for a frame before correcting itself, which on this particular screen
  // reads as the app telling you your mode is something it is not.
  const [choice, setChoice] = useState<"steady" | "lucky" | null>(null);

  const currentMode =
    reveal.state === "revealed" && typeof reveal.value === "boolean"
      ? reveal.value
        ? "lucky"
        : "steady"
      : null;

  const selection = choice ?? currentMode ?? "steady";

  if (!isConnected) {
    return (
      <ConnectPrompt
        title="Connect to choose your mode"
        description="Your yield mode is stored encrypted on-chain. Only your wallet can read it or change it."
      />
    );
  }

  const changed = currentMode !== null && selection !== currentMode;
  const unknown = currentMode === null;

  const submit = async () => {
    const hash = await tx.sendMode(selection === "lucky");
    if (hash) {
      notify({
        title: "Yield mode updated",
        description: "Your selection was submitted encrypted. Nobody can tell which you chose.",
        tone: "verified",
        txHash: hash,
      });
      reveal.hide();
      // Follow the revealed mode again now that the chain is the source of truth.
      setChoice(null);
      await refetch();
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Yield mode"
        title="Choose what happens to your yield"
        description="Your principal is unaffected either way. Only the destination of the yield changes."
      />

      <div className="flex flex-col gap-4">
        {/* Current mode */}
        <Card className="p-7 sm:p-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-eyebrow">Current mode</p>
              <div className="mt-2.5">
                <ConfidentialValue
                  state={reveal.state}
                  display={currentMode ? (currentMode === "lucky" ? "Lucky" : "Steady") : undefined}
                  error={reveal.error}
                  size="md"
                  currency={false}
                />
              </div>
            </div>
            <RevealButton
              state={reveal.state}
              onReveal={reveal.reveal}
              onHide={reveal.hide}
              labelReveal="Reveal mode"
              labelHide="Hide mode"
            />
          </div>

          {unknown ? (
            <PrivacyNote className="mt-5">
              Sable cannot display your mode without your authorisation — not even to you,
              until you ask.
            </PrivacyNote>
          ) : null}
        </Card>

        {/* Selector */}
        <Card className="p-7 sm:p-9">
          <p className="text-eyebrow mb-5">Select a mode</p>

          <div
            role="radiogroup"
            aria-label="Yield mode"
            className="relative grid grid-cols-2 gap-0 rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-inset)] p-1.5"
          >
            <motion.span
              aria-hidden="true"
              layout
              className="absolute inset-y-1.5 w-[calc(50%-6px)] rounded-[10px] bg-[var(--color-elevated)] ring-1 ring-[var(--color-hairline-accent)]"
              animate={{ left: selection === "steady" ? 6 : "calc(50% + 0px)" }}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
            />

            {(["steady", "lucky"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selection === option}
                onClick={() => setChoice(option)}
                className={cn(
                  "relative z-10 rounded-[10px] py-3.5 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
                  selection === option
                    ? "text-[var(--color-primary)]"
                    : "text-[var(--color-tertiary)] hover:text-[var(--color-secondary)]",
                )}
              >
                {option === "steady" ? "Steady" : "Lucky"}
              </button>
            ))}
          </div>

          <div className="mt-7 min-h-[112px]">
            <motion.div
              key={selection}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <h2
                className={cn(
                  "text-[20px] font-semibold tracking-[-0.02em]",
                  selection === "lucky" ? "text-[var(--color-accent)]" : "text-[var(--color-primary)]",
                )}
              >
                {selection === "steady" ? "Keep your yield." : "Pool your yield. Chase the upside."}
              </h2>
              <p className="mt-3 max-w-[52ch] text-[14px] leading-relaxed text-[var(--color-secondary)]">
                {selection === "steady"
                  ? "Your savings rewards compound privately into your own position. You will not be entered into prize draws."
                  : "Your yield goes to the shared prize pool, and your savings become eligible for confidential prize draws — weighted by how long you hold."}
              </p>
            </motion.div>
          </div>

          <div className="rule-fade my-7" />

          <Button
            size="lg"
            fullWidth
            onClick={submit}
            loading={tx.isBusy}
            disabled={unknown ? false : !changed}
          >
            {unknown
              ? `Set mode to ${selection === "lucky" ? "Lucky" : "Steady"}`
              : changed
                ? `Switch to ${selection === "lucky" ? "Lucky" : "Steady"}`
                : "This is already your mode"}
          </Button>

          <TransactionStatus stage={tx.stage} error={tx.error} detail={tx.detail} txHash={tx.txHash} className="mt-5" />

          <PrivacyNote className="mt-6">
            Your choice stays private. Both modes submit the identical transaction shape.
          </PrivacyNote>
        </Card>

        {/* The confidentiality explanation */}
        <Card className="p-7 sm:p-8">
          <h2 className="text-[15px] font-semibold text-[var(--color-primary)]">
            Why nobody can tell which you picked
          </h2>
          <ul className="mt-5 flex flex-col gap-3.5">
            {[
              "One function, one encrypted argument. There is no separate call for Lucky and Steady, so the selector reveals nothing.",
              "The event carries only your address — never the mode.",
              "Eligibility is computed with a homomorphic select over the encrypted bit, so both branches always execute.",
              "A Steady saver simply receives an empty ticket range, which is indistinguishable from any other allocation.",
            ].map((line) => (
              <li key={line} className="flex gap-3 text-[13px] leading-relaxed text-[var(--color-secondary)]">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
                {line}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
