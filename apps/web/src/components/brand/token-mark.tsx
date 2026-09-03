import { cn } from "@/lib/cn";

/**
 * Identifying marks for the assets Sable can hold.
 *
 * ## Why these are drawn locally rather than fetched
 *
 * Every token-list service serves logos from a CDN, and using one here would mean the
 * browser requesting an image per asset **from a page that lists what the wallet holds**.
 * The request pattern is the holdings: a third party would learn which tokens this address
 * carries, from its IP, without the saver ever agreeing to it. On a product whose whole
 * claim is that a financial position is nobody else's business, that is not a trade worth
 * making for a picture.
 *
 * So the marks are geometry, inline, and cost no requests at all.
 *
 * ## Why they are not the real brand logos
 *
 * These are Zama's **mock** tokens — testnet instruments that are not the assets they are
 * named after. Stamping the genuine USDC or Tether artwork on one would imply an issuer
 * relationship and a redeemability that do not exist, so each mark uses the currency's own
 * glyph on its brand colour instead: recognisable at a glance, without claiming to be the
 * issuer's mark.
 *
 * The treatment — a solid brand-coloured disc with a contrasting glyph — follows Zama's own
 * faucet, so an asset carries the same colour here as where it was minted.
 *
 * ## Contrast is checked, not assumed
 *
 * Every glyph clears 4.5:1 against its own disc. Two brand colours could not: Tether's green
 * reaches only 3.25:1 under white and Tether Gold's gold a hopeless 2.44:1, so both are
 * deepened until the glyph is legible. A logo nobody can read is not identification, and
 * these sit at 28px where the glyph is the whole signal.
 */

interface TokenVisual {
  /** The glyph drawn inside the chip. A currency sign where one exists, a monogram otherwise. */
  glyph: string;
  /** The disc colour: the asset's brand colour, deepened where the glyph needed the contrast. */
  tint: string;
  /** The glyph colour, chosen per token to clear 4.5:1 against `tint`. */
  ink: string;
  /** Shown to screen readers in place of the decorative chip. */
  label: string;
}

/**
 * Keyed by the *underlying* symbol rather than the confidential one, so `USDC`, `USDCMock`
 * and `cUSDCMock` all resolve to the same mark.
 */
const VISUALS: Record<string, TokenVisual> = {
  USDC: { glyph: "$", tint: "#2775CA", ink: "#FFFFFF", label: "USDC" },
  // Tether's #26A17B manages only 3.25:1 under white; deepened until the glyph reads.
  USDT: { glyph: "₮", tint: "#14795A", ink: "#FFFFFF", label: "Tether" },
  // Gold under white is 2.44:1, unreadable. Dark ink keeps the colour and gains 6.98:1.
  XAUT: { glyph: "T", tint: "#C0A265", ink: "#241B00", label: "Tether Gold" },
  WETH: { glyph: "◆", tint: "#3C3C3D", ink: "#FFFFFF", label: "Wrapped Ether" },
  BRON: { glyph: "B", tint: "#6F3FF5", ink: "#FFFFFF", label: "BRON" },
  ZAMA: { glyph: "Z", tint: "#FFD209", ink: "#0A0A0A", label: "Zama" },
  TGBP: { glyph: "£", tint: "#101014", ink: "#5B9BF5", label: "tGBP" },
};

const FALLBACK: TokenVisual = {
  glyph: "?",
  tint: "#5A5B55",
  ink: "#FFFFFF",
  label: "Unknown token",
};

/**
 * Reduces any of the symbols in circulation to a registry key.
 *
 * The same asset appears as `cUSDCMock` (confidential), `USDCMock` (underlying) and `USDC`
 * (the thing being mocked) depending on which contract was asked, so the leading `c` and the
 * trailing `Mock` are both stripped before lookup.
 */
export function tokenVisualKey(symbol: string): string {
  const withoutMock = symbol.replace(/mock$/i, "");

  // Try the symbol as-is first. Stripping the confidential `c` unconditionally would be
  // wrong for a token whose own name begins with one, and the prefix cannot be detected by
  // case alone — `ctGBP` is the confidential form of `tGBP`, where the letter after the
  // prefix is lowercase.
  const direct = withoutMock.toUpperCase();
  if (Object.hasOwn(VISUALS, direct)) return direct;

  return withoutMock.replace(/^c/, "").toUpperCase();
}

export function tokenVisual(symbol: string): TokenVisual {
  return VISUALS[tokenVisualKey(symbol)] ?? FALLBACK;
}

const SIZES = {
  sm: { box: "h-7 w-7", text: "text-[11px]" },
  md: { box: "h-9 w-9", text: "text-[13px]" },
} as const;

/**
 * A token's identifying chip.
 *
 * Decorative by default — the symbol is always written beside it in the interfaces that use
 * this, so announcing it again would only add noise for a screen reader. Pass `labelled` when
 * the mark stands alone.
 */
export function TokenMark({
  symbol,
  size = "md",
  labelled = false,
  className,
}: {
  symbol: string;
  size?: keyof typeof SIZES;
  labelled?: boolean;
  className?: string;
}) {
  const visual = tokenVisual(symbol);
  const { box, text } = SIZES[size];

  return (
    <span
      role={labelled ? "img" : undefined}
      aria-label={labelled ? visual.label : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        box,
        text,
        className,
      )}
      style={{
        // Inline because the colours are per token and Tailwind cannot generate a class for a
        // value that only exists at runtime.
        backgroundColor: visual.tint,
        color: visual.ink,
        /*
         * A hairline in the page's own foreground, not the token's.
         *
         * tGBP's disc is near-black and would otherwise dissolve into a dark card with no
         * edge at all. This is the same ring on every mark, so the set stays a set.
         */
        boxShadow: "inset 0 0 0 1px rgba(244, 243, 238, 0.10)",
      }}
    >
      {visual.glyph}
    </span>
  );
}
