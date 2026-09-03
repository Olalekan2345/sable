import Link from "next/link";
import { NETWORK_LABEL, PRODUCT, addresses, explorer } from "@sable/config";

import { SableLogo } from "@/components/brand/logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/app", label: "Dashboard" },
      { href: "/app/deposit", label: "Deposit" },
      { href: "/app/withdraw", label: "Withdraw" },
      { href: "/app/statements", label: "Statements" },
    ],
  },
  {
    title: "Transparency",
    links: [
      { href: "/draws", label: "Draw ledger" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/privacy", label: "Privacy model" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    title: "Technical",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs#architecture", label: "Architecture" },
      { href: "/docs#fhe", label: "FHE data model" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-hairline)] bg-[var(--color-void)]">
      <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <SableLogo size="md" />
            <p className="mt-5 max-w-[34ch] text-[13px] leading-relaxed text-[var(--color-tertiary)]">
              {PRODUCT.tagline} A confidential savings protocol where you privately choose how your
              yield works.
            </p>

            <div className="mt-7 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-hairline)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-tertiary)]">
                Built with Zama FHE
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-hairline)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-tertiary)]">
                {NETWORK_LABEL}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <div key={column.title}>
                <h2 className="text-eyebrow mb-4">{column.title}</h2>
                <ul className="flex flex-col gap-2.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-[13px] text-[var(--color-tertiary)] transition-colors hover:text-[var(--color-primary)]"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="rule-fade my-10" />

        <div className="flex flex-col gap-4 text-[12px] text-[var(--color-quaternary)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            Sable is a testnet protocol on {NETWORK_LABEL}. Test assets carry no value and are not
            redeemable.
          </p>

          {/* Only rendered once a real deployment exists — never a placeholder address. */}
          {addresses.sable ? (
            <a
              href={explorer.address(addresses.sable)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono transition-colors hover:text-[var(--color-accent)]"
            >
              Vault contract ↗
            </a>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
