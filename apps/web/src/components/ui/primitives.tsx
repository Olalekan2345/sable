"use client";

import Link from "next/link";
import { explorer, formatHandle, truncateHash } from "@sable/config";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/* ==========================================================================
   Card
   ========================================================================== */

export function Card({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "article";
}) {
  return <Tag className={cn("surface-card", className)}>{children}</Tag>;
}

export function CardHeader({
  title,
  eyebrow,
  action,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="text-eyebrow mb-2">{eyebrow}</p> : null}
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--color-primary)]">{title}</h2>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ==========================================================================
   Badge
   ========================================================================== */

type BadgeTone = "neutral" | "accent" | "verified" | "danger" | "caution";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "text-[var(--color-secondary)] border-[var(--color-hairline-strong)] bg-[var(--color-raised)]",
  accent: "text-[var(--color-accent)] border-[var(--color-hairline-accent)] bg-[rgba(255,206,26,0.07)]",
  verified: "text-[var(--color-verified)] border-[rgba(94,224,138,0.24)] bg-[rgba(94,224,138,0.06)]",
  danger: "text-[var(--color-danger)] border-[rgba(255,107,107,0.26)] bg-[rgba(255,107,107,0.06)]",
  caution: "text-[var(--color-caution)] border-[rgba(240,165,0,0.26)] bg-[rgba(240,165,0,0.06)]",
};

export function Badge({
  children,
  tone = "neutral",
  className,
  dot = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "font-mono text-[10px] font-medium uppercase tracking-[0.12em]",
        BADGE_TONES[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/* ==========================================================================
   CipherText
   ========================================================================== */

/**
 * Renders a ciphertext handle.
 *
 * Handles are public data — they identify a value without revealing it — so showing one
 * leaks nothing. Displaying them is how the interface makes encryption legible rather than
 * asking the saver to take it on faith.
 */
export function CipherText({
  handle,
  length = 16,
  className,
  label,
}: {
  handle: string | undefined;
  length?: number;
  className?: string;
  label?: string;
}) {
  if (!handle) return null;

  return (
    <span
      className={cn("text-cipher text-[10px] leading-none", className)}
      title={label ? `${label}: ${handle}` : handle}
    >
      {formatHandle(handle, length)}
    </span>
  );
}

/* ==========================================================================
   ExplorerLink
   ========================================================================== */

export function ExplorerLink({
  hash,
  address,
  label,
  className,
}: {
  hash?: string;
  address?: string;
  label?: string;
  className?: string;
}) {
  const href = hash ? explorer.tx(hash) : address ? explorer.address(address) : null;
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group inline-flex items-center gap-1.5 font-mono text-[11px]",
        "text-[var(--color-tertiary)] transition-colors hover:text-[var(--color-accent)]",
        className,
      )}
    >
      {label ?? truncateHash(hash ?? address ?? "")}
      <svg
        aria-hidden="true"
        viewBox="0 0 12 12"
        className="h-2.5 w-2.5 transition-transform duration-200 group-hover:-translate-y-px group-hover:translate-x-px"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      >
        <path d="M3.5 8.5L8.5 3.5M8.5 3.5H4.5M8.5 3.5V7.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/* ==========================================================================
   EmptyState
   ========================================================================== */

/**
 * The empty state.
 *
 * Sable shows these constantly by design — there is no seeded data anywhere — so they are
 * treated as a first-class screen rather than a fallback. Each one says what will appear
 * here and offers the action that makes it appear.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-14 text-center sm:py-20",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            "mb-6 flex h-14 w-14 items-center justify-center rounded-full",
            "border border-[var(--color-hairline)] bg-[var(--color-raised)] text-[var(--color-quaternary)]",
          )}
        >
          {icon}
        </div>
      ) : null}

      <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-secondary)]">
        {title}
      </h3>
      <p className="mt-3 max-w-[38ch] text-sm leading-relaxed text-[var(--color-tertiary)]">
        {description}
      </p>
      {action ? <div className="mt-7">{action}</div> : null}
    </div>
  );
}

/* ==========================================================================
   Skeleton
   ========================================================================== */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("shimmer rounded-[var(--radius-xs)] bg-[var(--color-elevated)]", className)}
    />
  );
}

/* ==========================================================================
   Section scaffolding
   ========================================================================== */

export function PageHeader({
  title,
  description,
  eyebrow,
  action,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="text-eyebrow mb-3">{eyebrow}</p> : null}
        <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-[var(--color-primary)] sm:text-[32px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2.5 max-w-[58ch] text-sm leading-relaxed text-[var(--color-secondary)]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/** A labelled row in a definition-style list. */
export function DataRow({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-6 border-b border-[var(--color-hairline)] py-3.5 last:border-0",
        className,
      )}
    >
      <dt className="shrink-0 text-[13px] text-[var(--color-tertiary)]">
        {label}
        {hint ? <span className="ml-1.5 text-[var(--color-quaternary)]">({hint})</span> : null}
      </dt>
      <dd className="min-w-0 text-right text-[13px] text-[var(--color-primary)]">{children}</dd>
    </div>
  );
}

/** The lock affordance repeated wherever a value is private to the viewer. */
export function PrivacyNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-[12px] text-[var(--color-tertiary)]", className)}>
      <LockIcon className="h-3 w-3 shrink-0 text-[var(--color-accent)]" />
      {children}
    </p>
  );
}

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" className={className}>
      <rect x="2.5" y="5.25" width="7" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M4.25 5.25V3.9a1.75 1.75 0 013.5 0v1.35" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** A link that looks like body text but behaves like a link. */
export function InlineLink({
  href,
  children,
  external,
  className,
}: {
  href: string;
  children: ReactNode;
  external?: boolean;
  className?: string;
}) {
  const classes = cn(
    "underline decoration-[var(--color-quaternary)] underline-offset-[3px]",
    "transition-colors hover:decoration-[var(--color-accent)] hover:text-[var(--color-accent)]",
    className,
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
