"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[var(--color-accent)] text-[var(--color-accent-ink)] font-semibold " +
    "hover:bg-[var(--color-accent-bright)] active:bg-[var(--color-accent-deep)] " +
    "shadow-[0_1px_0_0_rgba(255,255,255,0.24)_inset]",
  secondary:
    "bg-[var(--color-elevated)] text-[var(--color-primary)] border border-[var(--color-hairline-strong)] " +
    "hover:bg-[var(--color-overlay)] hover:border-[var(--color-hairline-accent)]",
  outline:
    "bg-transparent text-[var(--color-primary)] border border-[var(--color-hairline-strong)] " +
    "hover:border-[var(--color-hairline-accent)] hover:bg-[var(--color-raised)]",
  ghost:
    "bg-transparent text-[var(--color-secondary)] hover:text-[var(--color-primary)] " +
    "hover:bg-[var(--color-raised)]",
  danger:
    "bg-transparent text-[var(--color-danger)] border border-[rgba(255,107,107,0.28)] " +
    "hover:bg-[rgba(255,107,107,0.08)]",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-[13px] rounded-[var(--radius-sm)] gap-1.5",
  md: "h-11 px-5 text-sm rounded-[var(--radius-md)] gap-2",
  lg: "h-13 px-7 text-[15px] rounded-[var(--radius-md)] gap-2.5",
};

const BASE =
  "inline-flex items-center justify-center whitespace-nowrap select-none " +
  "transition-[background-color,border-color,color,transform,opacity] duration-200 " +
  "[transition-timing-function:var(--ease-out-quint)] " +
  "active:scale-[0.985] " +
  "disabled:opacity-40 disabled:pointer-events-none";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Rendered before the label. Hidden from assistive tech — the label carries meaning. */
  icon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, fullWidth, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      // `aria-busy` rather than swapping the label for a spinner: a screen-reader user
      // should still hear what the button does while it works.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className)}
      {...props}
    >
      {loading ? <Spinner /> : icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70"
    />
  );
}

export interface ButtonLinkProps {
  href: string;
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
  external?: boolean;
}

/** A link styled as a button. Stays an anchor, so middle-click and copy-link still work. */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  icon,
  fullWidth,
  className,
  children,
  external,
}: ButtonLinkProps) {
  const classes = cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className);

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={classes}>
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </Link>
  );
}
