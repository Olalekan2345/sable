"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

const STEPS = [
  { href: "/app/deposit/shield", label: "Shield" },
  { href: "/app/deposit", label: "Deposit" },
] as const;

/**
 * The two halves of getting money into Sable.
 *
 * They are genuinely different operations against different contracts, and conflating them
 * has been the source of most confusion here: **shielding** converts a public ERC-20 into
 * Zama's confidential token, while **depositing** moves that confidential token into the
 * vault. Sable issues nothing, so shielding is the only way value crosses into the
 * confidential side.
 *
 * Presented in order rather than as peers. Someone arriving with USDCMock needs the left
 * one; someone who already holds the confidential token can go straight to the right.
 */
export function DepositSteps({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Deposit steps"
      className={cn(
        "inline-flex rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-inset)] p-1",
        className,
      )}
    >
      {STEPS.map((step, index) => {
        const active = pathname === step.href;
        return (
          <Link
            key={step.href}
            href={step.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-[13px] transition-colors",
              active
                ? "bg-[var(--color-raised)] text-[var(--color-primary)]"
                : "text-[var(--color-tertiary)] hover:text-[var(--color-primary)]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "font-mono text-[10px]",
                active ? "text-[var(--color-accent)]" : "text-[var(--color-quaternary)]",
              )}
            >
              {index + 1}
            </span>
            {step.label}
          </Link>
        );
      })}
    </nav>
  );
}
