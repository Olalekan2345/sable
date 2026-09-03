"use client";

import { motion } from "motion/react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { Reveal, Section } from "./section";

/**
 * "Saving longer should matter."
 *
 * Two timelines against the same draw. The point is comparative, so the visual is
 * comparative: identical capital, different holding periods, visibly different eligibility.
 *
 * The formula sits behind a disclosure. A saver does not need it to understand the idea,
 * and leading with `balance × eligible minutes` would make a simple promise look like
 * homework — but anyone who wants to check the arithmetic can open it.
 */
export function TimeWeighting() {
  const [showTechnical, setShowTechnical] = useState(false);

  return (
    <Section>
      <div className="grid gap-16 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <div>
          <Reveal>
            <p className="text-eyebrow mb-5">Time weighting</p>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="text-display text-[clamp(2rem,4.6vw,3.4rem)] text-[var(--color-primary)]">
              Saving longer
              <br />
              should matter.
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-6 max-w-[42ch] text-[15px] leading-relaxed text-[var(--color-secondary)]">
              Draw eligibility is weighted by how much you saved and how long you actually held it —
              so depositing moments before a draw earns almost nothing.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <div className="mt-8">
              <button
                type="button"
                onClick={() => setShowTechnical((open) => !open)}
                aria-expanded={showTechnical}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3.5 py-2",
                  "border-[var(--color-hairline-strong)] font-mono text-[10px] uppercase tracking-[0.14em]",
                  "text-[var(--color-secondary)] transition-colors hover:border-[var(--color-hairline-accent)] hover:text-[var(--color-primary)]",
                )}
              >
                Technical details
                <svg
                  aria-hidden="true"
                  viewBox="0 0 12 12"
                  className={cn("h-2.5 w-2.5 transition-transform", showTechnical && "rotate-180")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                >
                  <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              <motion.div
                initial={false}
                animate={{ height: showTechnical ? "auto" : 0, opacity: showTechnical ? 1 : 0 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="surface-inset mt-4 p-5">
                  <p className="font-mono text-[11px] leading-relaxed text-[var(--color-secondary)]">
                    roundWeight += select(isLucky, balance × elapsedMinutes, 0)
                  </p>
                  <p className="mt-4 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
                    Weight accrues per whole minute, and only across intervals during which the
                    account was in Lucky mode. Because the mode is an encrypted bit, that gate runs
                    as a homomorphic <span className="font-mono">select</span> — both branches
                    execute, so the choice is never observable.
                  </p>
                  <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
                    Switching mode checkpoints first, so Steady time is never back-dated into
                    eligibility and Lucky time already earned is never clawed back.
                  </p>
                </div>
              </motion.div>
            </div>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <div className="surface-card grain p-7 sm:p-9">
            <Timeline
              label="Earlier deposit"
              markerAt={18}
              caption="More eligible time"
              emphasis
            />
            <div className="rule-fade my-9" />
            <Timeline label="Late deposit" markerAt={76} caption="Less eligible time" />

            <p className="mt-9 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
              Same amount saved. Different weight at the draw.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

function Timeline({
  label,
  markerAt,
  caption,
  emphasis = false,
}: {
  label: string;
  markerAt: number;
  caption: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-secondary)]">
          {label}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-quaternary)]">
          Draw
        </span>
      </div>

      <div className="relative h-8">
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--color-hairline-strong)]" />

        {/* Eligible span */}
        <motion.div
          className={cn(
            "absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full",
            emphasis ? "bg-[var(--color-accent)]" : "bg-[var(--color-quaternary)]",
          )}
          style={{ left: `${markerAt}%` }}
          initial={{ width: 0 }}
          whileInView={{ width: `${100 - markerAt}%` }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        />

        {/* Deposit marker */}
        <span
          className={cn(
            "absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ring-[var(--color-base)]",
            emphasis ? "bg-[var(--color-accent)]" : "bg-[var(--color-secondary)]",
          )}
          style={{ left: `${markerAt}%` }}
        />

        {/* Draw marker */}
        <span className="absolute right-0 top-1/2 h-3.5 w-px -translate-y-1/2 bg-[var(--color-secondary)]" />
      </div>

      <p
        className={cn(
          "mt-3 text-[12px]",
          emphasis ? "text-[var(--color-accent)]" : "text-[var(--color-tertiary)]",
        )}
        style={{ marginLeft: `${markerAt}%` }}
      >
        {caption}
      </p>
    </div>
  );
}
