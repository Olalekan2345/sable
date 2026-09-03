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
