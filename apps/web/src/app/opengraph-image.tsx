import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

/**
 * The social card.
 *
 * Generated rather than shipped as a static file so it stays in step with the product's
 * actual palette and wording. It carries the same masked-balance motif the app itself opens
 * with — a figure that is present but withheld — because that is the one image that explains
 * Sable without a caption.
 */
export const alt = "Sable — Save privately. Win fairly.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The mark, inlined.
 *
 * Satori resolves no relative URLs, so the artwork has to arrive as a data URI. A 100px-wide
 * copy is kept alongside the full one for exactly this — the card draws it at 132px tall, and
 * inlining the full-resolution file would put a megabyte into every render.
 */
async function markDataUri(): Promise<string> {
  const bytes = await readFile(join(process.cwd(), "public", "sable-mark-sm.png"));
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

export default async function OpengraphImage() {
  const mark = await markDataUri();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#090a08",
          padding: "72px 80px",
          // A single warm bloom, matching the landing hero's accent halo.
          backgroundImage:
            "radial-gradient(900px 420px at 50% 0%, rgba(255,206,26,0.12), transparent 70%)",
        }}
      >
        {/* Wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* Satori renders this to a PNG; there is no browser and no image pipeline. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} alt="" width={100} height={132} />
          <span
            style={{
              color: "#F4F3EE",
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: 6,
            }}
          >
            SABLE
          </span>
        </div>

        {/* The claim */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ color: "#F4F3EE", fontSize: 76, lineHeight: 1.04, letterSpacing: -2 }}>
            Your savings. Your choice.
          </div>
          <div style={{ color: "#6B6C66", fontSize: 76, lineHeight: 1.04, letterSpacing: -2 }}>
            Nobody else&rsquo;s business.
          </div>
        </div>

        {/* The masked balance, and what it means */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ color: "#6B6C66", fontSize: 17, letterSpacing: 4 }}>YOUR SAVINGS</span>
            <span style={{ color: "#9A9B94", fontSize: 62, letterSpacing: 10 }}>$ ••••••</span>
          </div>
          <span style={{ color: "#6B6C66", fontSize: 19, letterSpacing: 1 }}>
            Confidential savings · Zama FHE · Sepolia
          </span>
        </div>
      </div>
    ),
    size,
  );
}
