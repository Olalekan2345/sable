"use client";

import { ButtonLink } from "@/components/ui/button";
import { Lattice } from "./lattice";
import { Reveal } from "./section";

/**
 * Closing call to action.
 *
 * Three lines that restate the product as a promise rather than a feature list.
 */
export function FinalCta() {
  return (
    <section className="relative overflow-hidden py-32 sm:py-44">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <div className="grid-field absolute inset-0 opacity-40" />
        <Lattice className="opacity-50" seed={19} density={60} />
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(255,206,26,0.08),transparent_65%)]" />
      </div>

      <div className="mx-auto max-w-[1240px] px-5 text-center sm:px-8">
        <Reveal>
          <h2 className="text-display text-[clamp(2.4rem,6vw,4.2rem)] text-[var(--color-primary)]">
            Keep the balance.
            <br />
            Keep the choice.
            <br />
            <span className="text-[var(--color-accent)]">Keep it private.</span>
          </h2>
        </Reveal>

        <Reveal delay={0.12}>
          <div className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href="/app" size="lg">
              Open Sable
            </ButtonLink>
            <ButtonLink href="/draws" size="lg" variant="outline">
              Explore draws
            </ButtonLink>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
