"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { SableLogo } from "@/components/brand/logo";
import { cn } from "@/lib/cn";
import { FaucetButton } from "@/components/app/faucet-button";
import { WalletButton } from "./wallet-button";

const NAV = [
  { href: "/app", label: "Overview", exact: true, icon: OverviewIcon },
  { href: "/app/assets", label: "Assets", icon: AssetsIcon },
  { href: "/app/deposit", label: "Deposit", icon: DepositIcon },
  { href: "/app/withdraw", label: "Withdraw", icon: WithdrawIcon },
  { href: "/app/mode", label: "Yield mode", icon: ModeIcon },
  { href: "/app/rewards", label: "Rewards", icon: RewardsIcon },
  { href: "/app/activity", label: "Activity", icon: ActivityIcon },
  { href: "/app/statements", label: "Statements", icon: StatementIcon },
] as const;

/**
 * The phone bar has five slots. Four are destinations; the fifth opens everything else, so
 * no route is reachable on desktop but not on a phone.
 */
const MOBILE_PRIMARY = NAV.slice(0, 4);
const MOBILE_SECONDARY = NAV.slice(4);

/**
 * Navigation for the authenticated app.
 *
 * A sidebar on desktop, a bottom bar on mobile. Sable is conceptually a savings product,
 * so the phone layout is the one that has to feel right first — the bottom bar keeps every
 * primary action inside thumb reach rather than shrinking a desktop sidebar into a drawer.
 */
export function AppNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the sheet on navigation, adjusting state during render rather than in an effect so
  // the destination never paints with the sheet still over it.
  const [sheetPath, setSheetPath] = useState(pathname);
  if (pathname !== sheetPath) {
    setSheetPath(pathname);
    setMoreOpen(false);
  }

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* ------------------------------------------------------- Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-[var(--color-hairline)] px-4 py-6 lg:flex">
        <Link href="/" aria-label="Sable home" className="mb-9 px-2">
          <SableLogo size="sm" />
        </Link>

        <nav aria-label="Account" className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => {
            const active = isActive(item.href, "exact" in item ? item.exact : false);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-[13px] transition-colors",
                  active
                    ? "bg-[var(--color-raised)] text-[var(--color-primary)]"
                    : "text-[var(--color-tertiary)] hover:bg-[var(--color-raised)] hover:text-[var(--color-primary)]",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    active ? "text-[var(--color-accent)]" : "text-[var(--color-quaternary)]",
                  )}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6 border-t border-[var(--color-hairline)] pt-5">
          <Link
            href="/draws"
            className="block rounded-[var(--radius-sm)] px-3 py-2.5 text-[13px] text-[var(--color-tertiary)] transition-colors hover:text-[var(--color-primary)]"
          >
            Public draw ledger
          </Link>
          <Link
            href="/how-it-works"
            className="block rounded-[var(--radius-sm)] px-3 py-2.5 text-[13px] text-[var(--color-tertiary)] transition-colors hover:text-[var(--color-primary)]"
          >
            How it works
          </Link>
        </div>
      </aside>

      {/* -------------------------------------------------------- Mobile bar */}
      <nav
        aria-label="Account"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-hairline)] bg-[rgba(9,10,8,0.94)] backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="flex items-stretch justify-around">
          {MOBILE_PRIMARY.map((item) => {
            const active = isActive(item.href, "exact" in item ? item.exact : false);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1.5 px-1 py-3 text-[10px] transition-colors",
                    active ? "text-[var(--color-primary)]" : "text-[var(--color-quaternary)]",
                  )}
                >
                  <Icon
                    className={cn("h-[18px] w-[18px]", active && "text-[var(--color-accent)]")}
                  />
                  <span className="leading-none">{item.label.replace(" mode", "")}</span>
                </Link>
              </li>
            );
          })}

          {/*
            The bar holds five slots and the app has more destinations than that. Truncating
            the list left Activity unreachable on a phone entirely, so the last slot opens the
            remainder instead of dropping them.
          */}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              aria-controls="app-nav-more"
              className={cn(
                "flex w-full flex-col items-center gap-1.5 px-1 py-3 text-[10px] transition-colors",
                moreOpen || MOBILE_SECONDARY.some((item) => isActive(item.href))
                  ? "text-[var(--color-primary)]"
                  : "text-[var(--color-quaternary)]",
              )}
            >
              <MoreIcon
                className={cn("h-[18px] w-[18px]", moreOpen && "text-[var(--color-accent)]")}
              />
              <span className="leading-none">More</span>
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40 bg-[rgba(6,7,4,0.6)] lg:hidden"
          />
          <div
            id="app-nav-more"
            role="dialog"
            aria-modal="true"
            aria-label="More destinations"
            onKeyDown={(event) => {
              if (event.key === "Escape") setMoreOpen(false);
            }}
            className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 border-t border-[var(--color-hairline)] bg-[var(--color-raised)] p-3 lg:hidden"
          >
            {MOBILE_SECONDARY.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-3 text-[13px] transition-colors",
                    active
                      ? "bg-[var(--color-overlay)] text-[var(--color-primary)]"
                      : "text-[var(--color-tertiary)]",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4",
                      active ? "text-[var(--color-accent)]" : "text-[var(--color-quaternary)]",
                    )}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}

/** Top bar for the app: mobile branding plus the wallet control on every breakpoint. */
export function AppTopBar() {
  return (
    <div className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-[var(--color-hairline)] bg-[rgba(9,10,8,0.86)] px-5 backdrop-blur-xl sm:px-8">
      <Link href="/" aria-label="Sable home" className="lg:hidden">
        <SableLogo size="sm" showMark />
      </Link>
      <div className="hidden lg:block" />

      <div className="flex items-center gap-2 sm:gap-3">
        <FaucetButton />
        <WalletButton />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Icons — thin, geometric, and consistent with the mark's stroke weight.      */
/* -------------------------------------------------------------------------- */

interface IconProps {
  className?: string;
}

function base(className?: string) {
  return {
    className,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function OverviewIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="2" y="2.5" width="5" height="5" rx="1.2" />
      <rect x="9" y="2.5" width="5" height="5" rx="1.2" />
      <rect x="2" y="8.5" width="5" height="5" rx="1.2" />
      <rect x="9" y="8.5" width="5" height="5" rx="1.2" />
    </svg>
  );
}

function MoreIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="3.4" cy="8" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
      <circle cx="12.6" cy="8" r="1.1" />
    </svg>
  );
}

/** Stacked coins: the holdings view covers several tokens rather than one position. */
function AssetsIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <ellipse cx="8" cy="4.2" rx="5.2" ry="2.2" />
      <path d="M2.8 4.2v3.6c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2V4.2" />
      <path d="M2.8 7.8v3.6c0 1.2 2.3 2.2 5.2 2.2s5.2-1 5.2-2.2V7.8" />
    </svg>
  );
}

function DepositIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M8 2.5v7.5" />
      <path d="M5 7.2L8 10.2l3-3" />
      <path d="M2.5 12.5h11" />
    </svg>
  );
}

function WithdrawIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M8 10.5V3" />
      <path d="M5 5.8L8 2.8l3 3" />
      <path d="M2.5 12.5h11" />
    </svg>
  );
}

function ModeIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <rect x="1.8" y="4.6" width="12.4" height="6.8" rx="3.4" />
      <circle cx="10.8" cy="8" r="2" />
    </svg>
  );
}

function RewardsIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="8" cy="6.4" r="3.9" />
      <path d="M5.6 9.8L4.6 14l3.4-1.8L11.4 14l-1-4.2" />
    </svg>
  );
}

function ActivityIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M1.8 8h3l1.8-4.4 2.6 8.8 1.7-4.4h3.3" />
    </svg>
  );
}

function StatementIcon({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M3.5 2h6l3 3v9h-9z" />
      <path d="M9.3 2v3.2h3.1" />
      <path d="M5.6 8.6h4.8M5.6 11h3.2" />
    </svg>
  );
}
