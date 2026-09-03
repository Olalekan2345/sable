import { floorToRate, wrappedAmountFor } from "@sable/config";
import { describe, expect, it } from "vitest";

import { formatTokenAmount, validateTokenAmount } from "./token-amount-input";

/**
 * The shielding maths.
 *
 * These are the numbers a saver reads before deciding how much of their money to convert, so
 * being off by a factor of ten here is not a cosmetic bug. The cases below are the ones the
 * confidential-side helpers get wrong if reused directly: eighteen-decimal underlyings, and
 * wrappers whose `rate` is not one.
 */

const USDC = 6;
const WETH = 18;

describe("formatTokenAmount", () => {
  it("formats a six-decimal balance without false precision", () => {
    expect(formatTokenAmount(1_500_000n, USDC)).toBe("1.5");
    expect(formatTokenAmount(1_000_000n, USDC)).toBe("1");
  });

  it("groups thousands", () => {
    expect(formatTokenAmount(50_000_000_000n, USDC)).toBe("50,000");
  });

  it("does not overstate an eighteen-decimal balance", () => {
    // The confidential formatter assumes six decimals. Reusing it here would render one WETH
    // as a trillion, which is the specific mistake this helper exists to prevent.
    expect(formatTokenAmount(10n ** 18n, WETH)).toBe("1");
    expect(formatTokenAmount(10n ** 18n / 2n, WETH)).toBe("0.5");
  });

  it("truncates rather than rounds beyond the display limit", () => {
    // 0.1234567 WETH — the seventh digit is dropped, never rounded up into the sixth.
    expect(formatTokenAmount(123_456_700_000_000_000n, WETH)).toBe("0.123456");
  });

  it("renders zero as zero", () => {
    expect(formatTokenAmount(0n, USDC)).toBe("0");
    expect(formatTokenAmount(0n, WETH)).toBe("0");
  });
});

describe("validateTokenAmount", () => {
  const balance = 100_000_000n; // 100 USDCMock

  it("treats an empty field as neither valid nor an error", () => {
    expect(validateTokenAmount("", { decimals: USDC })).toEqual({ amount: null, error: null });
    expect(validateTokenAmount("   ", { decimals: USDC })).toEqual({ amount: null, error: null });
  });

  it("parses at the token's own precision", () => {
    expect(validateTokenAmount("1.5", { decimals: USDC }).amount).toBe(1_500_000n);
    expect(validateTokenAmount("1.5", { decimals: WETH }).amount).toBe(1_500_000_000_000_000_000n);
  });

  it("rejects zero and non-numeric input", () => {
    expect(validateTokenAmount("0", { decimals: USDC }).error).toBeTruthy();
    expect(validateTokenAmount("abc", { decimals: USDC }).error).toBeTruthy();
  });

  it("rejects more than the wallet holds", () => {
    const result = validateTokenAmount("101", { decimals: USDC, max: balance });
    expect(result.error).toContain("more than");
  });

  it("accepts exactly the wallet balance, so Max is always spendable", () => {
    const result = validateTokenAmount("100", { decimals: USDC, max: balance });
    expect(result).toEqual({ amount: balance, error: null });
  });

  it("does not enforce a maximum that is unknown", () => {
    expect(validateTokenAmount("999999", { decimals: USDC, max: null }).error).toBeNull();
  });
});

describe("shielding conversion", () => {
  it("converts one-to-one when the rate is one", () => {
    const rate = 1n;
    const amount = 25_000_000n; // 25 USDCMock

    expect(floorToRate(amount, rate)).toBe(amount);
    expect(wrappedAmountFor(amount, rate)).toBe(25_000_000n);
  });

  it("scales an eighteen-decimal underlying down to six confidential decimals", () => {
    // Zama's WETH wrapper uses rate 1e12, mapping 1e18 underlying units onto 1e6 confidential
    // units — so one WETH shields to exactly one confidential unit-equivalent.
    const rate = 1_000_000_000_000n;
    const oneWeth = 10n ** 18n;

    expect(wrappedAmountFor(oneWeth, rate)).toBe(1_000_000n);
  });

  it("floors to a whole multiple of the rate, and the remainder is what is left over", () => {
    const rate = 1_000_000_000_000n;
    const awkward = 10n ** 18n + 123n; // one WETH plus dust below the smallest wrappable unit

    const wrappable = floorToRate(awkward, rate);
    expect(wrappable).toBe(10n ** 18n);
    expect(awkward - wrappable).toBe(123n);
    expect(wrappedAmountFor(wrappable, rate)).toBe(1_000_000n);
  });

  it("shields nothing when the amount is below the smallest convertible unit", () => {
    // The page disables its button on exactly this condition rather than letting someone pay
    // gas for a wrap that converts zero.
    const rate = 1_000_000_000_000n;

    expect(floorToRate(999n, rate)).toBe(0n);
    expect(wrappedAmountFor(floorToRate(999n, rate), rate)).toBe(0n);
  });
});
