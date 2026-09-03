import type { MetadataRoute } from "next";
import { PRODUCT } from "@sable/config";

/**
 * Crawl rules.
 *
 * The public surfaces — landing, draw ledger, and the explanatory pages — are meant to be
 * found. The authenticated app and the operator dashboard are not: they are per-wallet
 * views with nothing useful to index, and `/admin` has no business appearing in search
 * results at all.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/app/", "/admin"],
    },
    sitemap: `${PRODUCT.url}/sitemap.xml`,
  };
}
