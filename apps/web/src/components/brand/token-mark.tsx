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
 * named after. Stamping the genuine USDC or Tether logo on one would imply an issuer
 * relationship and a redeemability that do not exist. Each mark instead uses the currency's
 * own glyph and a distinct tint, which is what identification actually needs.
 */

interface TokenVisual {
  /** The glyph drawn inside the chip. A currency sign where one exists, a monogram otherwise. */
  glyph: string;
  /** Tint for the ring and glyph, chosen to stay legible on the dark surface. */
  tint: string;
  /** Shown to screen readers in place of the decorative chip. */
  label: string;
}

/**
 * Keyed by the *underlying* symbol rather than the confidential one, so `USDC`, `USDCMock`
 * and `cUSDCMock` all resolve to the same mark.
 */
const VISUALS: Record<string, TokenVisual> = {
  USDC: { glyph: "$", tint: "#4d8ff5", label: "USDC" },
  USDT: { glyph: "₮", tint: "#3fb08a", label: "Tether" },
  XAUT: { glyph: "Au", tint: "#c9a227", label: "Tether Gold" },
  WETH: { glyph: "◆", tint: "#8a92f5", label: "Wrapped Ether" },
  BRON: { glyph: "B", tint: "#c47a4a", label: "BRON" },
  ZAMA: { glyph: "Z", tint: "#ffce1a", label: "Zama" },
  TGBP: { glyph: "£", tint: "#9a7fd4", label: "tGBP" },
};

const FALLBACK: TokenVisual = { glyph: "?", tint: "#6b6c66", label: "Unknown token" };

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
        "inline-flex shrink-0 items-center justify-center rounded-full border font-medium",
        box,
        text,
        className,
      )}
      style={{
        // Inline because the tint is per token and Tailwind cannot generate a class for a
        // value that only exists at runtime.
        borderColor: `${visual.tint}44`,
        backgroundColor: `${visual.tint}14`,
        color: visual.tint,
      }}
    >
      {visual.glyph}
    </span>
  );
}
