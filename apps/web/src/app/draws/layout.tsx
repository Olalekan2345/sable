import type { Metadata } from "next";

import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";

export const metadata: Metadata = {
  title: "Draw ledger",
  description:
    "Every Sable round, verifiable on Ethereum Sepolia. Round mechanics and prize totals are public; individual positions are not.",
};

/**
 * Public pages sit outside the app shell and need no wallet. Transparency that required a
 * connection would not be transparency.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="pt-28 pb-24">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
