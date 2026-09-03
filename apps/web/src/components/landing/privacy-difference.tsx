"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Reveal, Section } from "./section";

const VISIBLE = [
  { label: "Transaction", value: "0x9f2c…41ab" },
  { label: "Round", value: "#12" },
  { label: "Contract", value: "Sable Vault" },
  { label: "Execution", value: "Verified on-chain" },
];

const HIDDEN = [
  { label: "Balance", value: "$ 24,180.00" },
  { label: "Mode", value: "Lucky" },
  { label: "Draw weight", value: "1,046,400" },
  { label: "Odds", value: "1 in 62" },
  { label: "Prize result", value: "$ 412.90" },
];

/**
 * The signature section: "Even your choice is private."
 *
 * The right-hand column starts as legible plaintext and dissolves into ciphertext as it
 * scrolls into view. Showing the values first is the point — a column that was always
 * redacted proves nothing, whereas watching a mode and a balance disappear makes concrete
 * what is actually being protected.
 *
 * The plaintext here is illustrative typography, not data: there is no wallet connected,
 * no contract read, and these figures belong to nobody.
 */
export function PrivacyDifference() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-120px" });
  const reduceMotion = useReducedMotion();

  return (
    <Section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 -z-10 h-[560px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(255,206,26,0.05),transparent_65%)]"
      />

      <div className="mb-16 max-w-[54ch]">
        <Reveal>
          <p className="text-eyebrow mb-5">The privacy difference</p>
        </Reveal>
        <Reveal delay={0.06}>
          <h2 className="text-display text-[clamp(2rem,4.6vw,3.4rem)] text-[var(--color-primary)]">
            Even your choice
            <br />
            is private.
          </h2>
        </Reveal>
      </div>

      <div ref={ref} className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------ What is visible */}
        <Reveal>
          <div className="surface-card h-full p-7 sm:p-8">
            <header className="flex items-center gap-2.5">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-verified)]" />
              <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-secondary)]">
                What a chain observer sees
              </h3>
            </header>

            <dl className="mt-7 space-y-0">
              {VISIBLE.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-6 border-b border-[var(--color-hairline)] py-4 last:border-0"
                >
                  <dt className="text-[13px] text-[var(--color-tertiary)]">{row.label}</dt>
                  <dd className="font-mono text-[13px] text-[var(--color-primary)]">{row.value}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-7 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
              Everything needed to verify that the protocol ran correctly.
            </p>
          </div>
        </Reveal>

        {/* -------------------------------------------------- What is hidden */}
        <Reveal delay={0.1}>
          <div className="surface-card relative h-full overflow-hidden border-[var(--color-hairline-accent)] p-7 sm:p-8">
            <header className="flex items-center gap-2.5">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-secondary)]">
                What it cannot
              </h3>
            </header>

            <dl className="mt-7 space-y-0">
              {HIDDEN.map((row, index) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-6 border-b border-[var(--color-hairline)] py-4 last:border-0"
                >
                  <dt className="text-[13px] text-[var(--color-tertiary)]">{row.label}</dt>
                  <dd className="min-w-0 text-right">
                    <Encrypting
                      text={row.value}
                      start={inView}
                      delay={0.35 + index * 0.16}
                      reduceMotion={!!reduceMotion}
                    />
                  </dd>
                </div>
              ))}
            </dl>

            <p className="mt-7 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
              Encrypted end to end. Not even Sable&rsquo;s operators can read these.
            </p>
          </div>
        </Reveal>
      </div>

      <Reveal delay={0.16}>
        <blockquote className="mx-auto mt-16 max-w-[46ch] text-center">
          <p className="text-display text-[clamp(1.4rem,2.8vw,2rem)] text-[var(--color-primary)]">
            Sable doesn&rsquo;t just encrypt what you save. It encrypts{" "}
            <span className="text-[var(--color-accent)]">how you choose to save</span>.
          </p>
        </blockquote>
      </Reveal>
    </Section>
  );
}

const GLYPHS = "0123456789ABCDEF";

/** Dissolves readable text into fixed-width ciphertext once, on entering view. */
function Encrypting({
  text,
  start,
  delay,
  reduceMotion,
}: {
  text: string;
  start: boolean;
  delay: number;
  reduceMotion: boolean;
}) {
  const [animated, setAnimated] = useState<{ output: string; done: boolean } | null>(null);

  // Under reduced motion the encrypted form is the whole point and the scramble is only
  // decoration, so the end state is derived rather than animated into place.
  const settled = reduceMotion && start ? { output: cipherFor(text), done: true } : null;
  const { output, done } = settled ?? animated ?? { output: text, done: false };

  useEffect(() => {
    if (!start || reduceMotion || done) return;

    const timeout = window.setTimeout(() => {
      let frame = 0;
      const total = 12;

      const id = window.setInterval(() => {
        frame += 1;
        const scrambled = text
          .split("")
          .map((char) => (char === " " ? " " : GLYPHS[Math.floor(Math.random() * 16)] ?? char))
          .join("");

        setAnimated({ output: scrambled, done: false });

        if (frame >= total) {
          window.clearInterval(id);
          setAnimated({ output: cipherFor(text), done: true });
        }
      }, 46);
    }, delay * 1000);

    return () => window.clearTimeout(timeout);
  }, [start, delay, text, reduceMotion, done]);

  return (
    <motion.span
      animate={{ color: done ? "var(--color-quaternary)" : "var(--color-primary)" }}
      transition={{ duration: 0.5 }}
      className="font-mono text-[13px] break-all"
    >
      {output}
    </motion.span>
  );
}

/** A deterministic, fixed-length cipher stand-in of the same visual weight. */
function cipherFor(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;

  let out = "";
  for (let i = 0; i < 10; i++) {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    out += GLYPHS[hash % 16];
  }
  return `${out}…`;
}
