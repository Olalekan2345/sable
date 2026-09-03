"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { SableLogo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { WalletButton } from "./wallet-button";

const PUBLIC_LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/draws", label: "Draws" },
  { href: "/privacy", label: "Privacy" },
  { href: "/security", label: "Security" },
  { href: "/docs", label: "Docs" },
] as const;

/**
 * The public site header.
 *
 * Deliberately quiet: a wordmark, five links, and a single call to action. The wallet
 * control only appears once a visitor has gone looking for the app, because leading with
 * it would frame Sable as a crypto tool rather than a savings product.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile sheet on navigation by adjusting state during render rather than in an
  // effect. An effect would paint the new page once with the menu still covering it.
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setMobileOpen(false);
  }

  // Prevent the page scrolling behind the mobile sheet.
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        scrolled
          ? "border-b border-[var(--color-hairline)] bg-[rgba(9,10,8,0.82)] backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" aria-label="Sable home" className="shrink-0">
          <SableLogo size="sm" />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {PUBLIC_LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3.5 py-2 text-[13px] transition-colors",
                  active
                    ? "text-[var(--color-primary)]"
                    : "text-[var(--color-tertiary)] hover:text-[var(--color-primary)]",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <ButtonLink href="/app" size="sm" variant="primary" className="hidden sm:inline-flex">
            Open Sable
          </ButtonLink>

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-hairline-strong)] text-[var(--color-secondary)] lg:hidden"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              {mobileOpen ? (
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              ) : (
                <path d="M2.5 5h11M2.5 11h11" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen ? (
          <motion.div
            id="mobile-nav"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="border-t border-[var(--color-hairline)] bg-[var(--color-base)] px-5 py-6 lg:hidden"
          >
            <nav aria-label="Mobile" className="flex flex-col gap-1">
              {PUBLIC_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-[var(--radius-sm)] px-3 py-3 text-[15px] text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-primary)]"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="mt-5 flex flex-col gap-3">
              <ButtonLink href="/app" size="md" fullWidth>
                Open Sable
              </ButtonLink>
              <div className="flex justify-center">
                <WalletButton />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
