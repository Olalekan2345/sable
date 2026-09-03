/**
 * Shared types for the Sable monorepo.
 *
 * These mirror the on-chain structures in `SableTypes.sol`. Keeping them in one package
 * means the web app and the indexer cannot drift apart on what a round looks like.
 */

/** Lifecycle states, matching `SableTypes.RoundState` exactly. */
export enum RoundState {
  None = 0,
  Scheduled = 1,
  Open = 2,
  Closing = 3,
  Finalized = 4,
  Drawing = 5,
  Settling = 6,
  Complete = 7,
}

export const ROUND_STATE_LABELS: Record<RoundState, string> = {
  [RoundState.None]: "Not configured",
  [RoundState.Scheduled]: "Scheduled",
  [RoundState.Open]: "Open",
  [RoundState.Closing]: "Closing",
  [RoundState.Finalized]: "Finalized",
  [RoundState.Drawing]: "Drawing",
  [RoundState.Settling]: "Settling",
  [RoundState.Complete]: "Complete",
};

/**
 * Short explanations shown next to a round's state.
 *
 * Written for a saver, not an operator: what is happening, and what it means for them.
 */
export const ROUND_STATE_DESCRIPTIONS: Record<RoundState, string> = {
  [RoundState.None]: "This round has not been configured.",
  [RoundState.Scheduled]: "Configured and waiting to open.",
  [RoundState.Open]: "Accepting savings. Draw weight is accruing.",
  [RoundState.Closing]: "Closed to new weight. Final positions are being checkpointed.",
  [RoundState.Finalized]: "Positions locked. Prize pool published.",
  [RoundState.Drawing]: "Encrypted random numbers are being generated on-chain.",
  [RoundState.Settling]: "Results are being computed privately for every saver.",
  [RoundState.Complete]: "Settled. Winners can decrypt their own rewards.",
};

/** The two confidential yield modes. */
export type YieldMode = "steady" | "lucky";

/** Prize tiers, matching `SableTypes.Tier`. */
export enum Tier {
  Jackpot = 0,
  Mid = 1,
  Small = 2,
}

/** Public round configuration, as returned by `roundConfig(uint256)`. */
export interface RoundConfig {
  opensAt: bigint;
  closesAt: bigint;
  ticketBits: number;
  maxParticipants: number;
  weightPerTicket: bigint;
  jackpotWinnerCount: number;
  midWinnerCount: number;
  smallWinnerCount: number;
  jackpotShareBps: number;
  midShareBps: number;
  smallShareBps: number;
}

/** Public round lifecycle data, as returned by `roundState(uint256)`. */
export interface RoundLifecycle {
  state: RoundState;
  openedAt: bigint;
  closedAt: bigint;
  completedAt: bigint;
  participantCount: number;
  drawPointCount: number;
  eligibilityCursor: number;
  ticketCursor: number;
  drawCursor: number;
  settleCursor: bigint;
  jackpotResolved: boolean;
}

/** Ciphertext handles for a round's publicly decryptable aggregates. */
export interface RoundAggregateHandles {
  prizePool: `0x${string}`;
  jackpotPrize: `0x${string}`;
  midPrize: `0x${string}`;
  smallPrize: `0x${string}`;
  rollover: `0x${string}`;
}

/** A round's aggregates after public decryption. */
export interface RoundAggregates {
  prizePool: bigint | null;
  jackpotPrize: bigint | null;
  midPrize: bigint | null;
  smallPrize: bigint | null;
  rollover: bigint | null;
  jackpotHit: boolean | null;
}

/** Deployment record written by `deploy:sable`. */
export interface SableDeployment {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  contracts: {
    Sable: DeployedContract;
    /**
     * Present only when Sable deployed its own asset, which happens on local chains where
     * Zama's confidential tokens do not exist. On Sepolia the vault custodies Zama's
     * published `cUSDCMock` instead.
     */
    SableConfidentialUSD?: DeployedContract;
    /** Whichever yield adapter is wired to the vault. */
    YieldAdapter: DeployedContract;
  };
  asset: {
    /** The ERC-7984 the vault custodies. */
    address: string;
    /** The ERC-20 beneath it, when the asset is a wrapper. */
    underlying: string | null;
    symbol: string;
    /** Decimals of the confidential token. Six on every published Zama wrapper. */
    decimals: number;
    /**
     * Decimals of the underlying ERC-20, which may differ from the wrapper's. Recorded
     * because faucet and reserve funding operate on the underlying, not the wrapper.
     */
    underlyingDecimals: number;
    /** Underlying units per confidential unit, from `rate()`. `1` or `1e12` in practice. */
    rate: string;
    /** True when Sable issued the asset itself rather than using an ecosystem one. */
    selfIssued: boolean;
  };
  parameters: {
    participantCap: number;
    ratePerYearBps: number;
    /**
     * `reserve` when yield is paid from a pre-funded reserve (an asset Sable cannot mint);
     * `mint` when Sable issues the asset itself.
     */
    adapterKind: "reserve" | "mint";
    /** Public solvency bound for the reserve adapter, as a decimal string. */
    coveredDeposits: string | null;
  };
}

export interface DeployedContract {
  address: string;
  txHash: string;
  blockNumber: number;
}

/**
 * The stages a confidential transaction moves through in the UI.
 *
 * `encrypting` is deliberately its own stage rather than being folded into a generic
 * "loading": encrypting locally takes real time, and telling the saver what is happening
 * is the difference between a considered wait and a broken-feeling one.
 */
export type TxStage =
  | "idle"
  /** Asking the wallet to move to Sable's chain, before anything else happens. */
  | "switching-network"
  | "preparing"
  | "encrypting"
  | "awaiting-wallet"
  | "submitting"
  | "confirming"
  | "complete"
  | "error";

/** The stages of a private balance reveal. */
export type RevealStage = "hidden" | "authorizing" | "decrypting" | "revealed" | "error";
