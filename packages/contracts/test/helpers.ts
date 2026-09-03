import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";

import type {
  MockConfidentialUSDWrapper,
  MockUnderlyingUSD,
  Sable,
  SableConfidentialUSD,
  SableReserveYieldAdapter,
  SableTestnetYieldAdapter,
} from "../types";

/** Test USD uses 6 decimals, matching the ERC-7984 asset. */
export const UNIT = 1_000_000n;

/** Mirrors `SableMath.INDEX_SCALE`. */
export const INDEX_SCALE = 1_000_000n;

/** Mirrors `SableMath.MAX_CONFIDENTIAL_BALANCE` (1,000,000 test USD). */
export const MAX_BALANCE = 1_000_000_000_000n;

export const usd = (amount: number | bigint): bigint => BigInt(amount) * UNIT;

export interface Deployment {
  sable: Sable;
  token: SableConfidentialUSD;
  adapter: SableTestnetYieldAdapter;
  sableAddress: string;
  tokenAddress: string;
  admin: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  dave: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
}

export interface DeployOptions {
  /** Published annual rate in basis points. Zero disables yield accrual entirely. */
  ratePerYearBps?: number;
  /** Protocol participant cap. */
  participantCap?: number;
}

/**
 * Deploys the full Sable stack and funds the test wallets.
 *
 * Wiring mirrors `tasks/deploy.ts` exactly, so a mistake in deployment ordering shows up
 * in the test suite rather than only on Sepolia.
 */
export async function deploySable(options: DeployOptions = {}): Promise<Deployment> {
  const { ratePerYearBps = 0, participantCap = 32 } = options;

  const [admin, alice, bob, carol, dave, outsider] = await ethers.getSigners();

  const token = (await (
    await ethers.getContractFactory("SableConfidentialUSD")
  ).deploy(admin.address)) as unknown as SableConfidentialUSD;
  await token.waitForDeployment();

  const adapter = (await (
    await ethers.getContractFactory("SableTestnetYieldAdapter")
  ).deploy(await token.getAddress(), admin.address, ratePerYearBps)) as unknown as SableTestnetYieldAdapter;
  await adapter.waitForDeployment();

  const sable = (await (
    await ethers.getContractFactory("Sable")
  ).deploy(
    await token.getAddress(),
    await adapter.getAddress(),
    admin.address,
    participantCap,
  )) as unknown as Sable;
  await sable.waitForDeployment();

  const sableAddress = await sable.getAddress();
  const tokenAddress = await token.getAddress();

  await (await adapter.connect(admin).setVault(sableAddress)).wait();
  await (await token.connect(admin).setMinter(await adapter.getAddress(), true)).wait();
  await (await token.connect(admin).setMinter(admin.address, true)).wait();

  return { sable, token, adapter, sableAddress, tokenAddress, admin, alice, bob, carol, dave, outsider };
}

/** Mints test USD to `account` and authorises the vault as its ERC-7984 operator. */
export async function fund(
  deployment: Deployment,
  account: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const { token, admin, sableAddress } = deployment;
  await (await token.connect(admin).mint(account.address, amount)).wait();
  const expiry = (await time.latest()) + 365 * 24 * 3600;
  await (await token.connect(account).setOperator(sableAddress, expiry)).wait();
}

/** Encrypts a `euint64` input bound to (`contract`, `signer`). */
export async function encryptAmount(
  contractAddress: string,
  signer: HardhatEthersSigner,
  value: bigint,
): Promise<{ handle: string; proof: string }> {
  const encrypted = await fhevm.createEncryptedInput(contractAddress, signer.address).add64(value).encrypt();
  return {
    handle: ethers.hexlify(encrypted.handles[0]),
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

/** Encrypts an `ebool` input bound to (`contract`, `signer`). */
export async function encryptBool(
  contractAddress: string,
  signer: HardhatEthersSigner,
  value: boolean,
): Promise<{ handle: string; proof: string }> {
  const encrypted = await fhevm.createEncryptedInput(contractAddress, signer.address).addBool(value).encrypt();
  return {
    handle: ethers.hexlify(encrypted.handles[0]),
    proof: ethers.hexlify(encrypted.inputProof),
  };
}

/** Deposits `amount` from `account`. */
export async function deposit(
  deployment: Deployment,
  account: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const { handle, proof } = await encryptAmount(deployment.sableAddress, account, amount);
  await (await deployment.sable.connect(account).deposit(handle, proof)).wait();
}

/** Withdraws `amount` for `account`. */
export async function withdraw(
  deployment: Deployment,
  account: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const { handle, proof } = await encryptAmount(deployment.sableAddress, account, amount);
  await (await deployment.sable.connect(account).withdraw(handle, proof)).wait();
}

/** Sets the confidential mode. `lucky = true` selects Lucky. */
export async function setMode(
  deployment: Deployment,
  account: HardhatEthersSigner,
  lucky: boolean,
): Promise<void> {
  const { handle, proof } = await encryptBool(deployment.sableAddress, account, lucky);
  await (await deployment.sable.connect(account).setMode(handle, proof)).wait();
}

/** Decrypts a `euint64` handle as `account`. */
export async function readAmount(
  handle: string,
  contractAddress: string,
  account: HardhatEthersSigner,
): Promise<bigint> {
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, account);
}

/** Decrypts an `ebool` handle as `account`. */
export async function readBool(
  handle: string,
  contractAddress: string,
  account: HardhatEthersSigner,
): Promise<boolean> {
  return fhevm.userDecryptEbool(handle, contractAddress, account);
}

/** Reads `account`'s savings balance. */
export async function balanceOf(
  deployment: Deployment,
  account: HardhatEthersSigner,
): Promise<bigint> {
  const handle = await deployment.sable.confidentialBalanceOf(account.address);
  return readAmount(handle, deployment.sableAddress, account);
}

/** Reads `account`'s unclaimed reward. */
export async function rewardOf(
  deployment: Deployment,
  account: HardhatEthersSigner,
): Promise<bigint> {
  const handle = await deployment.sable.confidentialRewardOf(account.address);
  return readAmount(handle, deployment.sableAddress, account);
}

/** Reads `account`'s confidential mode. */
export async function modeOf(
  deployment: Deployment,
  account: HardhatEthersSigner,
): Promise<boolean> {
  const handle = await deployment.sable.confidentialModeOf(account.address);
  return readBool(handle, deployment.sableAddress, account);
}

/**
 * Reads `account`'s eligibility weight for `roundId`.
 *
 * A handle that was never written is the zero handle, which the relayer cannot decrypt.
 * That is the correct on-chain outcome for "no weight ever accrued" — the contract skips
 * the FHE work entirely rather than storing an encrypted zero — so it is normalised to
 * `0n` here. The web app applies the same rule; see `isUninitializedHandle` in the
 * frontend's confidential-value hook.
 */
export async function weightOf(
  deployment: Deployment,
  roundId: number,
  account: HardhatEthersSigner,
): Promise<bigint> {
  const handle = await deployment.sable.confidentialWeightOf(roundId, account.address);
  if (handle === ethers.ZeroHash) return 0n;
  return readAmount(handle, deployment.sableAddress, account);
}

/** True when a handle was never written, which reads as a confidential zero. */
export function isUninitialized(handle: string): boolean {
  return handle === ethers.ZeroHash;
}

/**
 * Resolves a handle the contract marked publicly decryptable.
 *
 * No wallet and no signature — this is the path `/draws` uses to show real prize figures
 * to a visitor who has not connected anything.
 */
export async function publicAmount(handle: string): Promise<bigint> {
  if (handle === ethers.ZeroHash) return 0n;
  return fhevm.publicDecryptEuint(FhevmType.euint64, handle);
}

/** Resolves a publicly decryptable boolean handle. */
export async function publicBool(handle: string): Promise<boolean> {
  return fhevm.publicDecryptEbool(handle);
}

/** Reads `account`'s ERC-7984 wallet balance. */
export async function walletBalanceOf(
  deployment: Deployment,
  account: HardhatEthersSigner,
): Promise<bigint> {
  const handle = await deployment.token.confidentialBalanceOf(account.address);
  return readAmount(handle, deployment.tokenAddress, account);
}

export interface RoundOptions {
  durationSeconds?: number;
  ticketBits?: number;
  maxParticipants?: number;
  weightPerTicket?: bigint;
  jackpotWinnerCount?: number;
  midWinnerCount?: number;
  smallWinnerCount?: number;
  jackpotShareBps?: number;
  midShareBps?: number;
  smallShareBps?: number;
  opensInSeconds?: number;
}

/**
 * Configures a round with the product's target tier shape (1 jackpot, 3 mid, 10 small)
 * unless overridden.
 */
/**
 * The subset of a deployment needed to drive a round. Both the own-token and
 * wrapped-asset fixtures satisfy this, so the lifecycle helpers work with either.
 */
export type RoundDriver = Pick<Deployment, "sable" | "admin">;

export async function configureRound(
  deployment: RoundDriver,
  options: RoundOptions = {},
): Promise<number> {
  const now = await time.latest();
  const {
    durationSeconds = 3600,
    ticketBits = 16,
    maxParticipants = 8,
    weightPerTicket = 10_000_000n,
    jackpotWinnerCount = 1,
    midWinnerCount = 3,
    smallWinnerCount = 10,
    jackpotShareBps = 5000,
    midShareBps = 3000,
    smallShareBps = 2000,
    opensInSeconds = 0,
  } = options;

  const opensAt = now + opensInSeconds;

  await (
    await deployment.sable.connect(deployment.admin).configureRound({
      opensAt,
      closesAt: opensAt + durationSeconds,
      ticketBits,
      maxParticipants,
      weightPerTicket,
      jackpotWinnerCount,
      midWinnerCount,
      smallWinnerCount,
      jackpotShareBps,
      midShareBps,
      smallShareBps,
    })
  ).wait();

  return Number(await deployment.sable.roundCount());
}

/**
 * Drives a round from CLOSING all the way to COMPLETE.
 *
 * Batch sizes are intentionally small so the suite exercises the resumable-cursor paths
 * rather than always completing each phase in a single call.
 */
export async function settleRound(
  deployment: RoundDriver,
  roundId: number,
  batchSize = 4,
): Promise<void> {
  const { sable, admin } = deployment;

  const total = Number((await sable.roundState(roundId)).participantCount);

  while (Number((await sable.roundState(roundId)).eligibilityCursor) < total) {
    await (await sable.connect(admin).processEligibilityBatch(roundId, batchSize)).wait();
  }

  await (await sable.connect(admin).finalizeRound(roundId)).wait();

  while (Number((await sable.roundState(roundId)).ticketCursor) < total) {
    await (await sable.connect(admin).assignTicketsBatch(roundId, batchSize)).wait();
  }

  const drawTotal = Number((await sable.roundState(roundId)).drawPointCount);
  while (Number((await sable.roundState(roundId)).drawCursor) < drawTotal) {
    await (await sable.connect(admin).drawBatch(roundId, batchSize)).wait();
  }

  while (Number((await sable.roundState(roundId)).settleCursor) < total) {
    await (await sable.connect(admin).settleBatch(roundId, 1)).wait();
  }

  await (await sable.connect(admin).completeRound(roundId)).wait();
}

/** Round lifecycle states, mirroring `SableTypes.RoundState`. */
export const RoundState = {
  NONE: 0,
  SCHEDULED: 1,
  OPEN: 2,
  CLOSING: 3,
  FINALIZED: 4,
  DRAWING: 5,
  SETTLING: 6,
  COMPLETE: 7,
} as const;

export { time };

/* ==========================================================================
   Wrapped-asset deployment

   Mirrors the Sepolia configuration, where Sable custodies Zama's canonical
   `cUSDCMock` — an `ERC7984ERC20Wrapper` over a publicly mintable ERC-20 — rather than a
   token Sable controls. Locally those contracts do not exist, so equivalents are deployed
   with the same shape (six decimals, rate 1).

   The vault is unchanged: it accepts any `IERC7984`. Only the yield adapter differs,
   because Sable cannot mint an asset it does not own and must pay yield from a reserve.
   ========================================================================== */

export interface WrappedDeployment extends Omit<Deployment, "token" | "adapter"> {
  token: SableConfidentialUSD;
  underlying: MockUnderlyingUSD;
  wrapper: MockConfidentialUSDWrapper;
  reserveAdapter: SableReserveYieldAdapter;
}

export interface WrappedDeployOptions {
  ratePerYearBps?: number;
  participantCap?: number;
  /** Underlying units to seed the reserve with. */
  fundUnderlying?: bigint;
}

export async function deployWrappedSable(
  options: WrappedDeployOptions = {},
): Promise<WrappedDeployment> {
  const { ratePerYearBps = 5000, participantCap = 4, fundUnderlying = usd(40_000) } = options;

  const [admin, alice, bob, carol, dave, outsider] = await ethers.getSigners();

  const underlying = (await (
    await ethers.getContractFactory("MockUnderlyingUSD")
  ).deploy()) as unknown as MockUnderlyingUSD;
  await underlying.waitForDeployment();

  const wrapper = (await (
    await ethers.getContractFactory("MockConfidentialUSDWrapper")
  ).deploy(await underlying.getAddress())) as unknown as MockConfidentialUSDWrapper;
  await wrapper.waitForDeployment();

  // Public solvency bound: nothing the vault can ever custody exceeds this.
  const coveredDeposits = MAX_BALANCE * BigInt(participantCap);

  const reserveAdapter = (await (
    await ethers.getContractFactory("SableReserveYieldAdapter")
  ).deploy(
    await wrapper.getAddress(),
    admin.address,
    ratePerYearBps,
    coveredDeposits,
  )) as unknown as SableReserveYieldAdapter;
  await reserveAdapter.waitForDeployment();

  const sable = (await (
    await ethers.getContractFactory("Sable")
  ).deploy(
    await wrapper.getAddress(),
    await reserveAdapter.getAddress(),
    admin.address,
    participantCap,
  )) as unknown as Sable;
  await sable.waitForDeployment();

  await (await reserveAdapter.connect(admin).setVault(await sable.getAddress())).wait();

  if (fundUnderlying > 0n) {
    await fundReserve({ underlying, reserveAdapter, admin }, fundUnderlying);
  }

  return {
    sable,
    token: wrapper as unknown as SableConfidentialUSD,
    underlying,
    wrapper,
    reserveAdapter,
    sableAddress: await sable.getAddress(),
    tokenAddress: await wrapper.getAddress(),
    admin,
    alice,
    bob,
    carol,
    dave,
    outsider,
  };
}

/** Mints the underlying and wraps it into the adapter's reserve. */
export async function fundReserve(
  deployment: {
    underlying: MockUnderlyingUSD;
    reserveAdapter: SableReserveYieldAdapter;
    admin: HardhatEthersSigner;
  },
  underlyingAmount: bigint,
): Promise<void> {
  const { underlying, reserveAdapter, admin } = deployment;
  await (await underlying.mint(admin.address, underlyingAmount)).wait();
  await (
    await underlying.connect(admin).approve(await reserveAdapter.getAddress(), underlyingAmount)
  ).wait();
  await (await reserveAdapter.connect(admin).fund(underlyingAmount)).wait();
}

/**
 * Gives an account a wrapped confidential balance, the way a saver would on Sepolia:
 * mint the public ERC-20, approve the wrapper, wrap.
 */
export async function fundWrapped(
  deployment: WrappedDeployment,
  account: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const { underlying, wrapper, sableAddress } = deployment;

  await (await underlying.mint(account.address, amount)).wait();
  await (await underlying.connect(account).approve(await wrapper.getAddress(), amount)).wait();
  await (await wrapper.connect(account).wrap(account.address, amount)).wait();

  const expiry = (await time.latest()) + 365 * 24 * 3600;
  await (await wrapper.connect(account).setOperator(sableAddress, expiry)).wait();
}
