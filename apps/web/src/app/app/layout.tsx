import type { Metadata } from "next";

import { AppNav, AppTopBar } from "@/components/shell/app-nav";
import { NetworkBanner } from "@/components/app/network-banner";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your confidential Sable savings position.",
  robots: { index: false, follow: false },
};

/**
 * The authenticated shell.
 *
 * Calmer than the landing page by design: no ambient motion, no gradients competing for
 * attention. Someone checking their savings wants clarity, not a show.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <AppNav />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopBar />
        <NetworkBanner />

        <main
          id="main"
          // Bottom padding clears the mobile tab bar.
          className="mx-auto w-full max-w-[880px] flex-1 px-5 pb-28 pt-8 sm:px-8 sm:pt-10 lg:pb-16"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
