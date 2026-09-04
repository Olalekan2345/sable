"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { Reveal, Section } from "./section";

/**
 * "One deposit. Two ways to earn."
 *
 * A split panel the visitor steers with the pointer or a keyboard. The interaction is the
 * argument: the same deposit sits on both sides, and only the destination of the yield
 * changes. Steady grows a quiet stack; Lucky sends particles to a shared prize object.
 */
export function TwoWays() {
  /*
   * Rests on Lucky, because Lucky is what a deposit does.
   *
   * The section used to open on Steady and fall back to it, which quietly framed the prize
   * draw as the thing you opt into. The contract has it the other way round — a new position
   * opens in Lucky and Steady is the opt-out — so resting here was teaching the wrong model
   * before a single word was read.
   */
  const [active, setActive] = useState<"steady" | "lucky">("lucky");
  const reduceMotion = useReducedMotion();

  return (
    <Section>
      <div className="mb-16 max-w-[52ch]">
        <Reveal>
          <p className="text-eyebrow mb-5">Two ways to save</p>
        </Reveal>
        <Reveal delay={0.06}>
          <h2 className="text-display text-[clamp(2rem,4.6vw,3.4rem)] text-[var(--color-primary)]">
            One deposit.
            <br />
            Two ways to earn.
          </h2>
        </Reveal>
      </div>

      <div
        className="grid gap-4 lg:grid-cols-2"
        onMouseLeave={() => setActive("lucky")}
      >
        <ModePanel
          mode="lucky"
          active={active === "lucky"}
          onActivate={() => setActive("lucky")}
          reduceMotion={!!reduceMotion}
          title="Lucky"
          headline="Pool the yield."
          body="The default. Depositing puts your yield into confidential prize draws, while your principal stays exactly where it is."
          visual={<LuckyVisual active={active === "lucky"} reduceMotion={!!reduceMotion} />}
        />

        <ModePanel
          mode="steady"
          active={active === "steady"}
          onActivate={() => setActive("steady")}
          reduceMotion={!!reduceMotion}
          title="Steady"
          headline="Keep the yield."
          body="Your attributable yield compounds into your private savings position. Nothing leaves, nothing is pooled."
          visual={<SteadyVisual active={active === "steady"} reduceMotion={!!reduceMotion} />}
        />
      </div>

      <Reveal delay={0.2}>
        <p className="mt-10 text-center text-[13px] text-[var(--color-tertiary)]">
          New savers start in Lucky, so depositing enters the draw. You can switch to Steady
          privately at any time, and neither choice is visible on-chain.
        </p>
      </Reveal>
    </Section>
  );
}

function ModePanel({
  mode,
  active,
  onActivate,
  title,
  headline,
  body,
  visual,
  reduceMotion,
}: {
  mode: "steady" | "lucky";
  active: boolean;
  onActivate: () => void;
  title: string;
  headline: string;
  body: string;
  visual: React.ReactNode;
  reduceMotion: boolean;
}) {
  return (
    <Reveal delay={mode === "lucky" ? 0.1 : 0}>
      <div
        // Focusable and hoverable: the reveal must not depend on a pointer.
        tabIndex={0}
        role="button"
        aria-pressed={active}
        aria-label={`${title}: ${headline}`}
        onMouseEnter={onActivate}
        onFocus={onActivate}
        onClick={onActivate}
        className={cn(
          "surface-card grain group relative h-full overflow-hidden p-7 sm:p-9",
          "cursor-pointer transition-all duration-500 [transition-timing-function:var(--ease-out-quint)]",
          active
            ? "border-[var(--color-hairline-accent)]"
            : "opacity-70 hover:opacity-100",
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 -z-10 transition-opacity duration-700",
            active ? "opacity-100" : "opacity-0",
          )}
          style={{
            background:
              mode === "lucky"
                ? "radial-gradient(circle at 70% 10%, rgba(255,206,26,0.09), transparent 60%)"
                : "radial-gradient(circle at 30% 10%, rgba(244,243,238,0.045), transparent 60%)",
          }}
        />

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-tertiary)]">
              {title}
            </p>
            <h3
              className={cn(
                "mt-3 text-[26px] font-semibold tracking-[-0.02em] transition-colors duration-500 sm:text-[30px]",
                active && mode === "lucky"
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-primary)]",
              )}
            >
              {headline}
            </h3>
          </div>

          <motion.span
            aria-hidden="true"
            animate={reduceMotion ? undefined : { opacity: active ? 1 : 0.25 }}
            className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]"
          />
        </div>

        <p className="mt-4 max-w-[40ch] text-[14px] leading-relaxed text-[var(--color-secondary)]">
          {body}
        </p>

        <div className="mt-9 h-[168px]">{visual}</div>
      </div>
    </Reveal>
  );
}

/**
 * A quiet stack growing upward — accumulation, not excitement.
 *
 * Runs whether or not the panel is hovered. Gating it on `active` meant the two visuals took
 * turns, so the section always had one dead half and the comparison it exists to draw was
 * never actually on screen at once.
 *
 * The motion had to change to survive that. It was a one-shot grow-in, which looks deliberate
 * when hover triggers it and looks broken when it has already happened by the time anyone
 * scrolls down. Now the bars rise and settle on a long staggered loop — slow enough to read as
 * interest accruing rather than a progress bar, and never returning to zero, because savings
 * do not empty and refill.
 */
function SteadyVisual({ active, reduceMotion }: { active: boolean; reduceMotion: boolean }) {
  const bars = [38, 52, 61, 74, 86, 97, 112, 128];

  return (
    <div className="flex h-full items-end justify-center gap-2.5">
      {bars.map((height, index) => (
        <motion.span
          key={index}
          className={cn(
            "w-5 rounded-t-[3px] bg-[linear-gradient(180deg,var(--color-elevated),var(--color-raised))] ring-1 transition-[opacity]",
            active ? "ring-[var(--color-hairline-strong)]" : "ring-[var(--color-hairline)]",
          )}
          initial={{ height: 8 }}
          animate={{
            // Reduced motion still gets the shape, just held still.
            height: reduceMotion ? height : [height * 0.78, height, height * 0.78],
            opacity: active ? 1 : 0.72,
          }}
          transition={{
            height: reduceMotion
              ? { duration: 0.75, ease: [0.22, 1, 0.36, 1] }
              : {
                  duration: 4.2,
                  repeat: Infinity,
                  ease: [0.4, 0, 0.2, 1],
                  delay: index * 0.12,
                },
            opacity: { duration: 0.4 },
          }}
        />
      ))}
    </div>
  );
}

/** Size of a travelling particle, in the 100-unit viewBox. */
const PARTICLE = 5.5;

/** Particles from several private balances converging on a shared prize. */
function LuckyVisual({ active, reduceMotion }: { active: boolean; reduceMotion: boolean }) {
  const sources = [
    { x: 12, y: 20 },
    { x: 30, y: 78 },
    { x: 68, y: 16 },
    { x: 86, y: 70 },
    { x: 18, y: 50 },
    { x: 82, y: 40 },
  ];

  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
        {sources.map((source, index) => (
          <g key={index}>
            <line
              x1={source.x}
              y1={source.y}
              x2="50"
              y2="50"
              stroke="var(--color-hairline)"
              strokeWidth="0.3"
            />
            {/*
              The yield itself, in the asset it accrues in.
              
              These were accent dots, which read as "something is moving" and nothing more.
              Using the token's own mark says what is travelling: interest leaving several
              private balances and arriving in one shared pool, which is the entire claim this
              panel makes.
              
              A 64px copy cropped to the mark's own disc, not the 1254px source — a page does
              not need 130KB to draw six particles, and the square would have flown as a white
              tile rather than a coin.
              
              Not gated on hover, for the same reason as the stack opposite: a comparison needs
              both halves alive.
            */}
            {!reduceMotion ? (
              <image
                href="/tokens/usdc-particle.png"
                width={PARTICLE}
                height={PARTICLE}
                x={-PARTICLE / 2}
                y={-PARTICLE / 2}
              >
                <animateMotion
                  dur={`${2.4 + index * 0.24}s`}
                  repeatCount="indefinite"
                  path={`M${source.x},${source.y} L50,50`}
                />
              </image>
            ) : (
              // Reduced motion parks each one at its source: the picture still shows several
              // balances feeding one pool, without anything travelling.
              <image
                href="/tokens/usdc-particle.png"
                width={PARTICLE}
                height={PARTICLE}
                x={source.x - PARTICLE / 2}
                y={source.y - PARTICLE / 2}
              />
            )}
          </g>
        ))}

        {/*
          The unhovered panel is de-emphasised, not switched off. At 0.3 the prize pool read as
          disabled beside a panel whose particles were moving; hover should shift attention,
          not decide which half of the section is working.
        */}
        <circle
          cx="50"
          cy="50"
          r="7"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="0.5"
          opacity={active ? 0.85 : 0.6}
        />
        <circle cx="50" cy="50" r="3.2" fill="var(--color-accent)" opacity={active ? 0.9 : 0.68} />
      </svg>

      <span className="pointer-events-none absolute inset-x-0 bottom-0 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--color-quaternary)]">
        Prize pool
      </span>
    </div>
  );
}
