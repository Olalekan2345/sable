import type { MetadataRoute } from "next";
import { PRODUCT } from "@sable/config";

/**
 * Web app manifest.
 *
 * Sable is conceptually a savings product, and savings products get checked on a phone. A
 * saver who adds it to their home screen should get the app shell, not the marketing page —
 * hence `start_url` pointing at the dashboard.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${PRODUCT.name} — ${PRODUCT.tagline}`,
    short_name: PRODUCT.name,
    description: PRODUCT.description,
    start_url: "/app",
    display: "standalone",
    background_color: "#090a08",
    theme_color: "#090a08",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
