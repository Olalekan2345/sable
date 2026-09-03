import type { Metadata, Viewport } from "next";

import { PRODUCT } from "@sable/config";

import { Providers } from "./providers";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(PRODUCT.url),
  title: {
    default: `${PRODUCT.name} — ${PRODUCT.tagline}`,
    template: `%s — ${PRODUCT.name}`,
  },
  description: PRODUCT.description,
  applicationName: PRODUCT.name,
  openGraph: {
    title: `${PRODUCT.name} — ${PRODUCT.tagline}`,
    description: PRODUCT.description,
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#090a08",
  width: "device-width",
  initialScale: 1,
  // Zooming is never disabled: the app shows financial figures, and pinching to read them
  // is a legitimate need rather than something to design away.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="antialiased">
        {/* Skip link — the first tab stop on every page. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-md focus:bg-[var(--color-accent)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--color-accent-ink)]"
        >
          Skip to content
        </a>

        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
