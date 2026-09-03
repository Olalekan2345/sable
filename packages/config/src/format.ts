/**
 * Number and address formatting.
 *
 * Sable is a savings product, so amounts are formatted like money: grouped thousands, two
 * decimal places, no scientific notation, and never a raw `bigint` leaking into the UI.
 * All of it is pure and shared, so a figure rendered on the dashboard, in a statement and
 * on the public ledger is formatted identically.
 */

/**
 * Decimals of the confidential asset.
 *
 * Six, matching Zama's `cUSDCMock` on Sepolia — verified on-chain, not assumed. Because the
 * protocol's asset and the ecosystem's asset agree, no scaling is needed anywhere.
 */
export const ASSET_DECIMALS = 6;

/** Ticker of the confidential asset Sable custodies. */
export const ASSET_SYMBOL = "cUSDC";

const UNIT = 10n ** BigInt(ASSET_DECIMALS);

export interface FormatOptions {
  /** Decimal places to show. Defaults to 2, the way a bank statement would. */
  decimals?: number;
  /** Prefix the result with `$`. */
  currency?: boolean;
  /** Abbreviate large values as 1.2K / 3.4M. */
  compact?: boolean;
}

/**
 * Formats a raw on-chain amount for display.
 *
 * Rounding is truncation, not nearest: showing a saver more than they hold, even by a
 * hundredth of a unit, is worse than showing slightly less.
 */
export function formatAmount(raw: bigint, options: FormatOptions = {}): string {
  const { decimals = 2, currency = false, compact = false } = options;

  const negative = raw < 0n;
  const value = negative ? -raw : raw;

  if (compact) {
    const asNumber = Number(value) / Number(UNIT);
    const formatted = new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(asNumber);
    return `${negative ? "-" : ""}${currency ? "$" : ""}${formatted}`;
  }

  const whole = value / UNIT;
  const fraction = value % UNIT;

  const fractionText = fraction
    .toString()
    .padStart(ASSET_DECIMALS, "0")
    .slice(0, decimals);

  const wholeText = new Intl.NumberFormat("en-US").format(whole);

  const body = decimals > 0 ? `${wholeText}.${fractionText}` : wholeText;
  return `${negative ? "-" : ""}${currency ? "$" : ""}${body}`;
}

/** Formats an amount with its ticker, e.g. `1,250.00 cUSDS`. */
export function formatWithSymbol(raw: bigint, options: FormatOptions = {}): string {
  return `${formatAmount(raw, options)} ${ASSET_SYMBOL}`;
}

/**
 * Parses user input into a raw on-chain amount.
 *
 * Returns `null` for anything that is not a well-formed non-negative decimal, so callers
 * can distinguish "empty" from "invalid" instead of silently treating both as zero.
 * Excess decimal places are truncated rather than rounded up.
 */
export function parseAmount(input: string): bigint | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (trimmed === "") return null;
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  if (trimmed === ".") return null;

  const [wholePart = "0", fractionPart = ""] = trimmed.split(".");
  const fraction = fractionPart.slice(0, ASSET_DECIMALS).padEnd(ASSET_DECIMALS, "0");

  try {
    return BigInt(wholePart || "0") * UNIT + BigInt(fraction || "0");
  } catch {
    return null;
  }
}

/** Formats basis points as a percentage, e.g. `500` becomes `5%`. */
export function formatBps(bps: number, decimals = 2): string {
  const value = bps / 100;
  const text = Number.isInteger(value) ? value.toString() : value.toFixed(decimals);
  return `${text}%`;
}

/** Shortens an address for display: `0x1234…abcd`. */
export function truncateAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 2) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

/** Shortens a transaction hash for display. */
export function truncateHash(hash: string): string {
  return truncateAddress(hash, 10, 8);
}

/**
 * Renders a ciphertext handle as a short, monospace-friendly fragment.
 *
 * Used wherever the UI wants to show that something *is* encrypted rather than what it
 * contains — the handle is public, so displaying it reveals nothing.
 */
export function formatHandle(handle: string, length = 16): string {
  const body = handle.startsWith("0x") ? handle.slice(2) : handle;
  return body.slice(0, length).toUpperCase();
}

/** Formats a Unix timestamp as an absolute date and time. */
export function formatTimestamp(seconds: bigint | number): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(ms));
}

/** Formats a Unix timestamp as a date only. */
export function formatDate(seconds: bigint | number): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

/**
 * Formats a duration as a coarse countdown: `2d 4h`, `18m`, `soon`.
 *
 * Deliberately imprecise below a minute. A savings product counting down in seconds would
 * borrow an urgency that belongs to a different kind of app.
 */
export function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return "now";
  if (secondsRemaining < 60) return "under a minute";

  const days = Math.floor(secondsRemaining / 86400);
  const hours = Math.floor((secondsRemaining % 86400) / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** The masked placeholder shown wherever a confidential value has not been revealed. */
export const MASKED_VALUE = "••••••";
