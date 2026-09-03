import { SiteFooter } from "@/components/shell/site-footer";
import { SiteHeader } from "@/components/shell/site-header";

/**
 * Shell for the explanatory pages: how it works, privacy, security, docs.
 *
 * All readable without a wallet. A privacy model nobody can read without connecting first
 * would be a poor advertisement for itself.
 */
export default function PublicContentLayout({ children }: { children: React.ReactNode }) {
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
