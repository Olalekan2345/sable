import type { MetadataRoute } from "next";
import { PRODUCT } from "@sable/config";

/**
 * Sitemap for the public surfaces only.
 *
 * Round pages are deliberately excluded even though they are public: they are generated
 * from live chain state, so a static list would go stale the moment a round is added, and
 * `/draws` already links every one of them.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: PRODUCT.url, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${PRODUCT.url}/how-it-works`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${PRODUCT.url}/draws`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: `${PRODUCT.url}/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${PRODUCT.url}/security`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${PRODUCT.url}/docs`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];
}
