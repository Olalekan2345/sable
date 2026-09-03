"use client";

import { NETWORK_LABEL } from "@sable/config";
import { motion, useReducedMotion } from "motion/react";

import { SableMark } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { LockIcon } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { CipherStream, Lattice } from "./lattice";

/**
 * The hero.
 *
 * The composition has to make one idea land before a visitor reads a word of body copy:
 * the ledger on the right is fully legible, and the position inside it is not. That
 * contrast *is* the product, so it is shown rather than described.
 *
 * Nothing here is a fabricated figure. The savings card displays its genuine masked state —
 * the same `$ ••••••` a real saver sees before revealing — and the ledger rows show
 * redaction bars, not invented dollar amounts.
 */
export function Hero() {
  const reduceMotion = useReducedMotion();

  const rise = (delay: number) =>
    reduceMotion
      ? { initial: undefined, animate: undefined }
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <section className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      {/* Backdrop */}
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div className="grid-field absolute inset-0 opacity-60" />
        <Lattice className="opacity-70" />
        <div className="absolute left-1/2 top-0 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(255,206,26,0.07),transparent_65%)]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[var(--color-base)]" />
      </div>

      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid items-center gap-16 lg:grid-cols-[1.05fr_1fr] lg:gap-12">
          {/* ---------------------------------------------------------- Copy */}
          <div>
            <motion.div {...rise(0)} className="mb-8 inline-flex items-center gap-2.5 rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-raised)] px-3.5 py-1.5">
              <SableMark className="h-3.5 w-3.5" />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-secondary)]">
                Confidential savings
              </span>
            </motion.div>

            <motion.h1
              {...rise(0.08)}
              className="text-display text-[clamp(2.6rem,7vw,4.6rem)] text-[var(--color-primary)]"
            >
              Your savings.
              <br />
              Your choice.
              <br />
              <span className="text-[var(--color-tertiary)]">Nobody else&rsquo;s business.</span>
            </motion.h1>

            <motion.p
              {...rise(0.16)}
              className="mt-7 max-w-[46ch] text-[15px] leading-relaxed text-[var(--color-secondary)] sm:text-base"
            >
              Deposit into a shared pool where the yield funds verifiable prize draws — then
              privately choose whether yours joins them or compounds to you. Your principal is
              never at stake, and you can withdraw it at any time.
            </motion.p>

            <motion.div {...rise(0.24)} className="mt-9 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/app" size="lg">
                Start saving
              </ButtonLink>
              <ButtonLink href="/privacy" size="lg" variant="outline">
                See how privacy works
              </ButtonLink>
            </motion.div>

            <motion.div
              {...rise(0.32)}
              className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-quaternary)]"
            >
              <span>Built with Zama FHE</span>
              <span aria-hidden="true" className="h-3 w-px bg-[var(--color-hairline-strong)]" />
              <span>{NETWORK_LABEL}</span>
            </motion.div>
          </div>

          {/* ------------------------------------------------------ Composition */}
          <motion.div
            initial={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <CipherStream
              className="absolute -left-14 top-6 hidden xl:block"
              rows={16}
              columns={6}
            />

            <div className="relative mx-auto max-w-[420px] lg:max-w-none">
              <SavingsCard reduceMotion={!!reduceMotion} />
              <LedgerCard reduceMotion={!!reduceMotion} />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/** The floating savings interface. Shows the true masked state, never an invented figure. */
function SavingsCard({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.div
      animate={reduceMotion ? undefined : { y: [0, -8, 0] }}
      transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      className={cn(
        "surface-card grain relative z-20 overflow-hidden p-6",
        "shadow-[0_40px_100px_-40px_rgba(0,0,0,1)]",
      )}
    >
      <div className="flex items-center justify-between">
        <SableMark className="h-5 w-5" />
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-quaternary)]">
          Save privately
        </span>
      </div>

      <p className="text-eyebrow mt-7">Your savings</p>

      <div className="accent-halo mt-2.5">
        <span className="masked-value text-[38px] font-semibold">$ ••••••</span>
      </div>

      <p className="mt-3.5 flex items-center gap-2 text-[11px] text-[var(--color-tertiary)]">
        <LockIcon className="h-3 w-3 text-[var(--color-accent)]" />
        Balance visible only to you
      </p>

      <div className="rule-fade my-6" />

      <ModeToggle reduceMotion={reduceMotion} />
    </motion.div>
  );
}

/**
 * The Steady/Lucky control, animating between states.
 *
 * Purely illustrative here — the real control lives at `/app/mode`. The animation exists to
 * show that the choice is a single, quiet switch rather than two different public actions.
 */
function ModeToggle({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div>
      <div className="relative flex rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-inset)] p-1">
        <motion.span
          aria-hidden="true"
          className="absolute inset-y-1 w-[calc(50%-4px)] rounded-[10px] bg-[var(--color-elevated)] ring-1 ring-[var(--color-hairline-accent)]"
          animate={reduceMotion ? { left: 4 } : { left: ["4px", "calc(50% + 0px)", "4px"] }}
          transition={{ duration: 7, repeat: Infinity, ease: [0.76, 0, 0.24, 1], times: [0, 0.5, 1] }}
        />
        {/*
          Lucky sits first, where the highlight rests. A new position opens in Lucky, so
          showing the switch parked on Steady would illustrate the opposite of what depositing
          actually does.
        */}
        <span className="relative z-10 flex-1 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-secondary)]">
          Lucky
        </span>
        <span className="relative z-10 flex-1 py-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-secondary)]">
          Steady
        </span>
      </div>

      <p className="mt-3 flex items-center gap-2 text-[11px] text-[var(--color-tertiary)]">
        <LockIcon className="h-3 w-3 text-[var(--color-accent)]" />
        Your choice stays private
      </p>
    </div>
  );
}

/**
 * The public ledger card.
 *
 * Sits behind and below the savings card. Its structural columns are legible while every
 * participant column is redacted — the visual thesis of the product in one object.
 */
function LedgerCard({ reduceMotion }: { reduceMotion: boolean }) {
  const rows = [
    { label: "Participant", width: "72%" },
    { label: "Balance", width: "54%" },
    { label: "Mode", width: "38%" },
    { label: "Ticket range", width: "64%" },
  ];

  return (
    <motion.div
      animate={reduceMotion ? undefined : { y: [0, 6, 0] }}
      transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
      className={cn(
        "relative z-10 -mt-8 ml-6 rounded-[var(--radius-lg)] border border-[var(--color-hairline)]",
        "bg-[var(--color-void)]/90 p-5 pt-12 backdrop-blur-sm sm:ml-10",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-tertiary)]">
          Public draw ledger
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-verified)]">
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-current" />
          Verifiable
        </span>
      </div>

      <div className="mt-4 space-y-2.5">
        {rows.map((row, index) => (
          <div key={row.label} className="flex items-center gap-3">
            <span className="w-[86px] shrink-0 font-mono text-[9px] text-[var(--color-quaternary)]">
              {row.label}
            </span>
            <motion.span
              aria-hidden="true"
              className="h-2 rounded-[2px] bg-[repeating-linear-gradient(90deg,var(--color-elevated)_0_6px,transparent_6px_9px)]"
              initial={reduceMotion ? { width: row.width } : { width: 0 }}
              whileInView={{ width: row.width }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.5 + index * 0.09, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        ))}
      </div>

      <div className="rule-fade my-4" />

      <p className="text-[10px] leading-relaxed text-[var(--color-quaternary)]">
        Round mechanics are public. Positions are not.
      </p>
    </motion.div>
  );
}
