"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Shared scaffolding for landing sections.
 *
 * Every section enters the same way — a short rise, once, on first view. Consistency here
 * matters more than variety: a page where each block animates differently reads as a demo
 * reel rather than a product.
 */

export function Section({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("relative py-24 sm:py-32", className)}>
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">{children}</div>
    </section>
  );
}

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-[52ch]",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow ? <Reveal><p className="text-eyebrow mb-5">{eyebrow}</p></Reveal> : null}

      <Reveal delay={0.06}>
        <h2 className="text-display text-[clamp(2rem,4.6vw,3.4rem)] text-[var(--color-primary)]">
          {title}
        </h2>
      </Reveal>

      {description ? (
        <Reveal delay={0.12}>
          <div className="mt-5 text-[15px] leading-relaxed text-[var(--color-secondary)]">
            {description}
          </div>
        </Reveal>
      ) : null}
    </div>
  );
}
