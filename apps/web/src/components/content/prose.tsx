import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Long-form content primitives.
 *
 * Measure is capped near 68 characters and body text sits at 15px with generous leading —
 * these pages carry the explanations that decide whether someone trusts the protocol, so
 * they are typeset to be read rather than skimmed.
 */

export function ContentPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto max-w-[760px] px-5 sm:px-8">
      <header className="mb-14">
        <p className="text-eyebrow mb-5">{eyebrow}</p>
        <h1 className="text-display text-[clamp(2.2rem,5vw,3.4rem)] text-[var(--color-primary)]">
          {title}
        </h1>
        {intro ? (
          <p className="mt-6 max-w-[62ch] text-[16px] leading-relaxed text-[var(--color-secondary)]">
            {intro}
          </p>
        ) : null}
      </header>

      <div className="flex flex-col gap-14">{children}</div>
    </article>
  );
}

export function ContentSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-[21px] font-semibold tracking-[-0.02em] text-[var(--color-primary)]">
        {title}
      </h2>
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("max-w-[68ch] text-[15px] leading-[1.75] text-[var(--color-secondary)]", className)}>
      {children}
    </p>
  );
}

export function Note({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border p-5",
        tone === "accent"
          ? "border-[var(--color-hairline-accent)] bg-[rgba(255,206,26,0.04)]"
          : "border-[var(--color-hairline)] bg-[var(--color-raised)]",
      )}
    >
      <p className="max-w-[64ch] text-[14px] leading-relaxed text-[var(--color-secondary)]">
        {children}
      </p>
    </div>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex max-w-[68ch] flex-col gap-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3 text-[15px] leading-[1.7] text-[var(--color-secondary)]">
          <span aria-hidden="true" className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A two-column comparison — used repeatedly for "protected" versus "not protected". */
export function Comparison({
  left,
  right,
}: {
  left: { title: string; items: string[]; tone?: "verified" | "danger" };
  right: { title: string; items: string[]; tone?: "verified" | "danger" };
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[left, right].map((column) => (
        <div key={column.title} className="surface-inset p-6">
          <h3
            className={cn(
              "font-mono text-[10px] uppercase tracking-[0.16em]",
              column.tone === "verified"
                ? "text-[var(--color-verified)]"
                : column.tone === "danger"
                  ? "text-[var(--color-caution)]"
                  : "text-[var(--color-secondary)]",
            )}
          >
            {column.title}
          </h3>
          <ul className="mt-4 flex flex-col gap-2.5">
            {column.items.map((item) => (
              <li key={item} className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function CodeBlock({ children, caption }: { children: string; caption?: string }) {
  return (
    <figure>
      <pre className="surface-inset overflow-x-auto p-5 font-mono text-[12px] leading-[1.7] text-[var(--color-secondary)]">
        <code>{children}</code>
      </pre>
      {caption ? (
        <figcaption className="mt-2.5 text-[12px] text-[var(--color-tertiary)]">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
