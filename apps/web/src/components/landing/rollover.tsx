"use client";

import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { Reveal, Section } from "./section";

/**
 * The rollover section.
 *
 * A yellow point travels the fixed ticket lattice and lands in unallocated space. `NO MATCH`
 * becomes `JACKPOT ROLLS FORWARD`.
 *
 * This is the moment where a cryptographic constraint becomes product storytelling.
 * `FHE.randEuint64` requires a power-of-two bound, so the ticket space is fixed at `2^k`
 * and some of it is always unassigned — a fact that could read as a bug and instead reads
 * as an escalating jackpot. Presenting it as anything other than intentional would be both
 * dishonest and a wasted opportunity.
 */
export function Rollover() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-140px" });
  const reduceMotion = useReducedMotion();
  const [animatedPhase, setAnimatedPhase] = useState<
    "idle" | "travelling" | "landed" | "rolled"
  >("idle");

  // Under reduced motion the sequence has no intermediate states to show, so the finished
  // phase is derived rather than assigned — the component starts where it would have ended.
  const phase = reduceMotion ? "rolled" : animatedPhase;

  useEffect(() => {
    if (!inView || reduceMotion) return;

    const timers = [
      window.setTimeout(() => setAnimatedPhase("travelling"), 300),
      window.setTimeout(() => setAnimatedPhase("landed"), 2400),
      window.setTimeout(() => setAnimatedPhase("rolled"), 3800),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [inView, reduceMotion]);

  return (
    <Section className="relative overflow-hidden">
      <div className="grid gap-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-20">
        <Reveal>
          <div ref={ref} className="surface-card grain relative overflow-hidden p-7 sm:p-9">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-tertiary)]">
                Ticket space
              </span>
              <span className="font-mono text-[10px] text-[var(--color-quaternary)]">
                0 &rarr; 2<sup>16</sup>
              </span>
            </div>

            <TicketLattice phase={phase} reduceMotion={!!reduceMotion} />

            <div className="mt-8 h-[62px]">
              <AnimatePresence mode="wait">
                {phase === "landed" ? (
                  <motion.p
                    key="no-match"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3 }}
                    className="font-mono text-[13px] uppercase tracking-[0.2em] text-[var(--color-secondary)]"
                  >
                    No match
                  </motion.p>
                ) : phase === "rolled" ? (
                  <motion.div
                    key="rolled"
                    initial={reduceMotion ? undefined : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <p className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--color-accent)] sm:text-[26px]">
                      Jackpot rolls forward
                    </p>
                    <p className="mt-2 text-[12px] text-[var(--color-tertiary)]">
                      Carried into the next round&rsquo;s prize pool.
                    </p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </Reveal>

        <div>
          <Reveal>
            <p className="text-eyebrow mb-5">Rollover</p>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="text-display text-[clamp(2rem,4.6vw,3.4rem)] text-[var(--color-primary)]">
              When nothing
              <br />
              matches, it grows.
            </h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mt-6 max-w-[40ch] text-[15px] leading-relaxed text-[var(--color-secondary)]">
              An unmatched jackpot draw carries forward instead of exposing private ticket
              boundaries. Nobody loses anything — the prize simply gets larger.
            </p>
          </Reveal>
          <Reveal delay={0.18}>
            <p className="mt-5 max-w-[40ch] text-[13px] leading-relaxed text-[var(--color-tertiary)]">
              Savers occupy private ranges inside a fixed ticket space. Some of that space is always
              unassigned, and a random point landing there matches no one — which is exactly what
              keeps the boundaries secret.
            </p>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

function TicketLattice({
  phase,
  reduceMotion,
}: {
  phase: "idle" | "travelling" | "landed" | "rolled";
  reduceMotion: boolean;
}) {
  // Allocated ranges, then a wide dark tail the point lands in.
  const segments = [
    { start: 0, width: 14 },
    { start: 15, width: 9 },
    { start: 25, width: 17 },
    { start: 43, width: 6 },
    { start: 50, width: 11 },
  ];

  const landingX = 78;

  return (
    <div className="relative mt-7">
      <div className="relative h-14 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-inset)]">
        {/* Allocated ranges — deliberately unlabelled: whose is whose is the secret. */}
        {segments.map((segment, index) => (
          <motion.span
            key={index}
            className="absolute inset-y-2 rounded-[3px] bg-[var(--color-elevated)] ring-1 ring-[var(--color-hairline-strong)]"
            style={{ left: `${segment.start}%`, width: `${segment.width}%` }}
            initial={reduceMotion ? undefined : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: index * 0.07 }}
          />
        ))}

        {/* The unallocated tail. */}
        <span className="absolute inset-y-2 right-0 left-[61%] rounded-[3px] bg-[repeating-linear-gradient(45deg,rgba(244,243,238,0.03)_0_5px,transparent_5px_10px)]" />

        {/* The encrypted random point. */}
        <motion.span
          className={cn(
            "absolute top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent)]",
            phase !== "idle" && "shadow-[0_0_16px_4px_rgba(255,206,26,0.45)]",
          )}
          initial={{ left: "0%", opacity: 0 }}
          animate={
            phase === "idle"
              ? { left: "0%", opacity: 0 }
              : phase === "travelling"
                ? { left: `${landingX}%`, opacity: 1 }
                : { left: `${landingX}%`, opacity: 1, scale: [1, 1.5, 1] }
          }
          transition={
            phase === "travelling"
              ? { duration: 2, ease: [0.32, 0, 0.2, 1] }
              : { duration: 0.6 }
          }
        />
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--color-quaternary)]">
        <span>Allocated to savers</span>
        <span>Unassigned</span>
      </div>
    </div>
  );
}
