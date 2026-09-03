/**
 * `@sable/config` — the single source of truth for anything both the web app and the
 * indexer need to agree on: chain, addresses, ABIs, shared types and formatting.
 *
 * Nothing here reaches the network or reads a private key.
 */

export * from "./chain";
export * from "./assets";
export * from "./wrapper";
export * from "./types";
export * from "./format";
export * from "./addresses";
export {
  sableAbi,
  confidentialAssetAbi,
  yieldAdapterAbi,
  reserveAdapterAbi,
  deployments,
} from "./generated";

/** Product constants used across surfaces. */
export const PRODUCT = {
  name: "Sable",
  tagline: "Save privately. Win fairly.",
  description:
    "A confidential savings protocol. Deposit privately, and privately choose whether your yield compounds or funds a verifiable prize draw.",
  url: "https://sable.finance",
} as const;

/**
 * Mirrors `SableMath` so the UI can validate before a saver spends gas discovering a
 * limit. These must stay in step with the contract; `packages/contracts/test` is what
 * proves the contract half.
 */
export const PROTOCOL_LIMITS = {
  /** `SableMath.MAX_CONFIDENTIAL_BALANCE` — 1,000,000 cUSDS. */
  maxBalance: 1_000_000_000_000n,
  /** `SableMath.INDEX_SCALE`. */
  indexScale: 1_000_000n,
  /** `SableMath.WEIGHT_TIME_UNIT` — weight accrues per whole minute. */
  weightTimeUnitSeconds: 60,
  /** `SableMath.MAX_ROUND_DURATION`. */
  maxRoundDurationSeconds: 30 * 24 * 3600,
} as const;

/**
 * Measured homomorphic cost per phase, from `packages/contracts/test/benchmark.hcu.ts`.
 * Surfaced in the operator dashboard and the docs so batch sizes are explainable rather
 * than magic numbers.
 */
export const HCU_BUDGET = {
  maxGlobalPerTx: 20_000_000,
  maxDepthPerTx: 5_000_000,
  measured: {
    deposit: 1_129_096,
    withdraw: 1_129_032,
    setMode: 96,
    eligibilityPerAccount: 2_055_596,
    ticketsPerAccount: 1_027_008,
    settlementPerAccount: 7_560_448,
    finalizeRound: 5_385_000,
    completeRound: 388_096,
  },
  batchDefaults: {
    eligibility: 8,
    tickets: 16,
    draw: 14,
    settle: 2,
  },
} as const;
