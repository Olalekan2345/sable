"use client";

import { motion } from "motion/react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { Reveal, Section } from "./section";

/**
 * "Savings first."
 *
 * The principal bar never moves; only the yield arrow changes destination. That is the
 * literal truth of the contract — the prize pool is fed exclusively from a
 * `select(isLucky, yield, 0)` expression, and no code path anywhere moves principal into
 * a reward — so the visual is an accurate diagram rather than a reassuring metaphor.
 *
 * The claim is scoped carefully. It says your principal is never awarded to another saver,
 * not that DeFi is risk-free.
 */
export function Principal() {
  const [route, setRoute] = useState<"steady" | "lucky">("steady");

  return (
    <Section>
      <div className="grid gap-16 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:gap-20">
        <div>
          <Reveal>
            <p className="text-eyebrow mb-5">Principal safety</p>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="text-display text-[clamp(2rem,4.6vw,3.4rem)] text-[var(--color-primary)]">
              Savings first.
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-6 max-w-[40ch] text-[15px] leading-relaxed text-[var(--color-secondary)]">
              Prize participation changes where your yield goes. It does not give away your
              deposited principal.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <p className="mt-5 max-w-[40ch] text-[13px] leading-relaxed text-[var(--color-tertiary)]">
              Withdraw whenever you like — there is no lock-up, and withdrawals stay available even
              if the protocol is paused. Your principal is never awarded to another saver; prizes
              are funded from yield alone.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <div className="surface-card grain p-7 sm:p-10">
            {/* Principal — fixed, whichever route is selected. */}
            <div>
              <div className="mb-3 flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-secondary)]">
                  Principal
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-verified)]">
                  Always yours
                </span>
              </div>
              <div className="h-11 rounded-[var(--radius-sm)] bg-[linear-gradient(90deg,var(--color-elevated),var(--color-overlay))] ring-1 ring-[var(--color-hairline-strong)]" />
            </div>

            {/* Yield routing */}
            <div className="mt-8">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-secondary)]">
                  Yield
                </span>
                <span className="font-mono text-[10px] text-[var(--color-quaternary)]">
                  routes to your choice
                </span>
              </div>

              <div className="relative h-16">
                <svg viewBox="0 0 200 60" className="h-full w-full" aria-hidden="true" preserveAspectRatio="none">
                  <motion.path
                    d={route === "steady" ? "M100,0 L100,26 L36,26 L36,54" : "M100,0 L100,26 L164,26 L164,54"}
                    stroke="var(--color-accent)"
                    strokeWidth="1.4"
                    fill="none"
                    strokeLinecap="round"
                    initial={false}
                    animate={{ d: route === "steady" ? "M100,0 L100,26 L36,26 L36,54" : "M100,0 L100,26 L164,26 L164,54" }}
                    transition={{ duration: 0.5, ease: [0.76, 0, 0.24, 1] }}
                  />
                  <motion.circle
                    r="2.4"
                    fill="var(--color-accent)"
                    initial={false}
                    animate={{ cx: route === "steady" ? 36 : 164, cy: 54 }}
                    transition={{ duration: 0.5, ease: [0.76, 0, 0.24, 1] }}
                  />
                </svg>
              </div>

              <div
                role="radiogroup"
                aria-label="Yield destination"
                className="grid grid-cols-2 gap-3"
              >
                {(["steady", "lucky"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={route === option}
                    onClick={() => setRoute(option)}
                    className={cn(
                      "rounded-[var(--radius-sm)] border px-4 py-3.5 text-left transition-all duration-300",
                      route === option
                        ? "border-[var(--color-hairline-accent)] bg-[var(--color-elevated)]"
                        : "border-[var(--color-hairline)] bg-transparent hover:border-[var(--color-hairline-strong)]",
                    )}
                  >
                    <span
                      className={cn(
                        "block font-mono text-[10px] uppercase tracking-[0.16em]",
                        route === option ? "text-[var(--color-accent)]" : "text-[var(--color-tertiary)]",
                      )}
                    >
                      {option === "steady" ? "Steady" : "Lucky"}
                    </span>
                    <span className="mt-1.5 block text-[12px] text-[var(--color-secondary)]">
                      {option === "steady" ? "Compounds to you" : "Funds the prize pool"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rule-fade my-7" />

            <p className="text-[12px] leading-relaxed text-[var(--color-tertiary)]">
              Sable runs on a test network with a testnet asset. As with any smart contract, the
              code itself carries risk — but no rule in it can route your principal to somebody
              else&rsquo;s prize.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
