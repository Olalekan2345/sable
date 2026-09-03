"use client";

import { motion, useInView } from "motion/react";
import { useRef } from "react";

import { InlineLink } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { Reveal, Section } from "./section";

const STEPS = [
  {
    number: "01",
    title: "Encrypt",
    body: "Your browser encrypts the amount and your mode before either leaves your device, and attaches a zero-knowledge proof that the ciphertext is well-formed.",
    terms: ["Relayer SDK"],
  },
  {
    number: "02",
    title: "Compute",
    body: "Sable's contracts add, compare and select over that ciphertext without ever decrypting it. Your balance is arithmetic the protocol can do but cannot read.",
    terms: ["FHEVM", "Zama Protocol"],
  },
  {
    number: "03",
    title: "Verify",
    body: "Every operation executes on-chain, in public transactions anyone can inspect. The mechanics are auditable even though the values are not legible.",
    terms: ["Ethereum Sepolia"],
  },
  {
    number: "04",
    title: "Reveal",
    body: "Only you can decrypt your own results, authorised by a signature from your wallet and enforced by the protocol's access control list.",
    terms: ["Access Control List"],
  },
] as const;

/**
 * "How Zama makes it possible."
 *
 * Four stages rather than a wall of cryptography. Real terminology is used and linked,
 * because a saver who wants to check the claims should be able to — but the body copy
 * explains what happens to *their money*, not how a lattice works.
 */
export function ZamaSteps() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <Section className="relative">
      <div className="mb-16 max-w-[52ch]">
        <Reveal>
          <p className="text-eyebrow mb-5">The technology</p>
        </Reveal>
        <Reveal delay={0.06}>
          <h2 className="text-display text-[clamp(2rem,4.6vw,3.4rem)] text-[var(--color-primary)]">
            How this is
            <br />
            even possible.
          </h2>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mt-6 text-[15px] leading-relaxed text-[var(--color-secondary)]">
            Sable is built on fully homomorphic encryption — arithmetic that works directly on
            encrypted numbers. It is what lets a smart contract compute your yield and your draw
            weight without anyone, including us, seeing them.
          </p>
        </Reveal>
      </div>

      <div ref={ref} className="relative">
        {/* The spine connecting the four stages. */}
        <motion.div
          aria-hidden="true"
          className="absolute left-[27px] top-2 w-px bg-[var(--color-hairline-strong)] md:left-0 md:top-[27px] md:h-px md:w-full"
          initial={{ scaleY: 0, scaleX: 0 }}
          animate={inView ? { scaleY: 1, scaleX: 1 } : {}}
          style={{ transformOrigin: "top left" }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />

        <ol className="grid gap-10 md:grid-cols-4 md:gap-6">
          {STEPS.map((step, index) => (
            <li key={step.number} className="relative flex gap-5 md:flex-col md:gap-0">
              <motion.span
                className={cn(
                  "relative z-10 flex h-14 w-14 shrink-0 items-center justify-center rounded-full",
                  "border border-[var(--color-hairline-strong)] bg-[var(--color-base)]",
                  "font-mono text-[11px] text-[var(--color-accent)]",
                )}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={inView ? { opacity: 1, scale: 1 } : {}}
                transition={{ duration: 0.5, delay: 0.2 + index * 0.13, ease: [0.22, 1, 0.36, 1] }}
              >
                {step.number}
              </motion.span>

              <motion.div
                className="md:mt-7"
                initial={{ opacity: 0, y: 14 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.3 + index * 0.13, ease: [0.22, 1, 0.36, 1] }}
              >
                <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--color-primary)]">
                  {step.title}
                </h3>
                <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--color-secondary)]">
                  {step.body}
                </p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {step.terms.map((term) => (
                    <span
                      key={term}
                      className="rounded-full border border-[var(--color-hairline)] px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--color-quaternary)]"
                    >
                      {term}
                    </span>
                  ))}
                </div>
              </motion.div>
            </li>
          ))}
        </ol>
      </div>

      <Reveal delay={0.2}>
        <p className="mt-14 text-[13px] text-[var(--color-tertiary)]">
          <InlineLink href="/docs">Read the technical architecture</InlineLink> — contracts, the FHE
          data model, the draw algorithm and the exact privacy boundaries.
        </p>
      </Reveal>
    </Section>
  );
}
