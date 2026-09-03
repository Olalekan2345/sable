import { describe, expect, it } from "vitest";

import { tokenVisual, tokenVisualKey } from "./token-mark";

/**
 * Symbol normalisation.
 *
 * The same asset reaches this code under three names depending on which contract was asked —
 * `cUSDCMock`, `USDCMock`, `USDC` — and a mark that silently falls back to a question mark is
 * the kind of defect nobody files but everybody notices.
 */
describe("tokenVisualKey", () => {
  it("resolves all three forms of the same asset to one key", () => {
    expect(tokenVisualKey("cUSDCMock")).toBe("USDC");
    expect(tokenVisualKey("USDCMock")).toBe("USDC");
    expect(tokenVisualKey("USDC")).toBe("USDC");
  });

  it("handles a confidential prefix before a lowercase symbol", () => {
    // `ctGBP` is the confidential form of `tGBP`. Detecting the prefix by case alone fails
    // here, which is exactly how these rendered as an unknown-token mark.
    expect(tokenVisualKey("ctGBPMock")).toBe("TGBP");
    expect(tokenVisualKey("ctGBP")).toBe("TGBP");
    expect(tokenVisualKey("tGBP")).toBe("TGBP");
  });

  it("does not strip a leading c that belongs to the symbol", () => {
    // A token whose own name starts with `c` must survive lookup untouched.
    expect(tokenVisualKey("USDC")).toBe("USDC");
  });
});

describe("tokenVisual", () => {
  const SYMBOLS = [
    "cUSDCMock",
    "cUSDTMock",
    "cXAUtMock",
    "cWETHMock",
    "cBRONMock",
    "cZAMAMock",
    "ctGBPMock",
    "ctGBP",
  ];

  it("gives every published asset its own mark, never the fallback", () => {
    for (const symbol of SYMBOLS) {
      expect(tokenVisual(symbol).glyph, `${symbol} should resolve to a real mark`).not.toBe("?");
    }
  });

  it("distinguishes assets by tint so two rows are never identical", () => {
    const tints = SYMBOLS.map((symbol) => tokenVisual(symbol).tint);
    // tGBP and ctGBP are the same asset in mock and real form, so one repeat is expected.
    expect(new Set(tints).size).toBe(SYMBOLS.length - 1);
  });

  it("falls back rather than throwing on an unknown symbol", () => {
    expect(tokenVisual("cWHATEVER").glyph).toBe("?");
  });
});

/**
 * Contrast, enforced rather than trusted.
 *
 * These marks are 28px and the glyph carries the whole identification, so a glyph that does
 * not read makes the mark decorative noise. Two brand colours failed when the solid treatment
 * was introduced — Tether's green at 3.25:1 under white, Tether Gold's gold at 2.44:1 — and
 * both were deepened until they passed. That correction is easy to undo later by someone
 * restoring an "accurate" brand colour, which is exactly why it is asserted.
 */
describe("mark legibility", () => {
  const luminance = (hex: string) => {
    const h = hex.replace("#", "");
    const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const linear = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };

  const contrast = (a: string, b: string) => {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  const SYMBOLS = ["USDC", "USDT", "XAUT", "WETH", "BRON", "ZAMA", "TGBP", "NOPE"];

  it("draws every glyph at 4.5:1 or better against its own disc", () => {
    for (const symbol of SYMBOLS) {
      const visual = tokenVisual(symbol);
      const ratio = contrast(visual.tint, visual.ink);
      expect(ratio, `${symbol}: ${visual.ink} on ${visual.tint} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
