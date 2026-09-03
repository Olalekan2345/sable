"use client";

import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";

import { isSdkLoaded, loadRelayerSdk } from "./loader";

let instancePromise: Promise<FhevmInstance> | null = null;
let publicInstancePromise: Promise<FhevmInstance> | null = null;

/** Fallback public endpoint, used only when no RPC URL is configured. */
const DEFAULT_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

export { isSdkLoaded };

/**
 * Returns the shared FHEVM instance, creating it on first use.
 *
 * The network is the injected provider rather than a plain RPC URL: the SDK needs to read
 * the ACL and KMS contracts, and reusing the wallet's provider keeps that on whatever
 * endpoint the saver already trusts.
 */
export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (typeof window === "undefined") {
    throw new Error("The Zama Relayer SDK is browser-only.");
  }

  if (!instancePromise) {
    instancePromise = (async () => {
      const sdk = await loadRelayerSdk();
      const ethereum = (window as unknown as { ethereum?: unknown }).ethereum;

      if (!ethereum) {
        throw new Error("No wallet provider found. Connect a wallet to use confidential features.");
      }

      return sdk.createInstance({
        ...sdk.SepoliaConfig,
        network: ethereum as never,
      });
    })().catch((error) => {
      instancePromise = null;
      throw error;
    });
  }

  return instancePromise;
}

/**
 * Returns an instance backed by a plain RPC endpoint rather than a wallet.
 *
 * The public draw ledger has to render real prize figures for a visitor who has connected
 * nothing at all. Public decryption needs no signature — the authorisation lives in the
 * on-chain ACL — so it only needs somewhere to read chain state from, and requiring a
 * wallet here would make the transparency page conditional on having one.
 */
export async function getPublicFhevmInstance(): Promise<FhevmInstance> {
  if (typeof window === "undefined") {
    throw new Error("The Zama Relayer SDK is browser-only.");
  }

  if (!publicInstancePromise) {
    publicInstancePromise = (async () => {
      const sdk = await loadRelayerSdk();
      return sdk.createInstance({
        ...sdk.SepoliaConfig,
        network: process.env.NEXT_PUBLIC_RPC_URL || DEFAULT_RPC_URL,
      });
    })().catch((error) => {
      publicInstancePromise = null;
      throw error;
    });
  }

  return publicInstancePromise;
}

/** Clears the cached instance. Used when the wallet or chain changes underneath us. */
export function resetFhevmInstance(): void {
  instancePromise = null;
}

export interface EncryptedInput {
  handle: `0x${string}`;
  proof: `0x${string}`;
}

function toHex(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out as `0x${string}`;
}

/**
 * Encrypts an amount for a specific contract and caller.
 *
 * The ciphertext is bound to both addresses, which is why a proof produced for one wallet
 * cannot be replayed by another — the contract's `FHE.fromExternal` rejects it.
 */
export async function encryptAmount(
  contractAddress: string,
  userAddress: string,
  value: bigint,
): Promise<EncryptedInput> {
  const instance = await getFhevmInstance();
  const input = instance.createEncryptedInput(contractAddress, userAddress);
  input.add64(value);
  const { handles, inputProof } = await input.encrypt();

  const handle = handles[0];
  if (!handle) throw new Error("Encryption produced no handle.");

  return { handle: toHex(handle), proof: toHex(inputProof) };
}

/**
 * Encrypts the confidential yield mode.
 *
 * `true` is Lucky. Nothing about the call downstream differs between the two values — same
 * function, same calldata length, same event — so this is the only place in the entire
 * stack where the choice exists in plaintext, and it never leaves the browser.
 */
export async function encryptMode(
  contractAddress: string,
  userAddress: string,
  lucky: boolean,
): Promise<EncryptedInput> {
  const instance = await getFhevmInstance();
  const input = instance.createEncryptedInput(contractAddress, userAddress);
  input.addBool(lucky);
  const { handles, inputProof } = await input.encrypt();

  const handle = handles[0];
  if (!handle) throw new Error("Encryption produced no handle.");

  return { handle: toHex(handle), proof: toHex(inputProof) };
}

/**
 * An authorisation to decrypt, valid for a bounded window.
 *
 * Held in memory only. Persisting it would mean a shared or recovered browser profile
 * could read a saver's balance without their wallet present, which defeats the point.
 */
export interface DecryptionAuthorization {
  publicKey: string;
  privateKey: string;
  signature: string;
  contracts: string[];
  userAddress: string;
  startTimestamp: number;
  durationDays: number;
}

const AUTH_DURATION_DAYS = 1;

let cachedAuth: DecryptionAuthorization | null = null;

/** Signature callback, supplied by the wallet layer. */
export type TypedDataSigner = (args: {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}) => Promise<string>;

/**
 * Obtains (or reuses) an EIP-712 authorisation for user decryption.
 *
 * A fresh keypair is generated per authorisation and the private half never leaves this
 * module. The saver signs a statement naming the contracts and a validity window; the KMS
 * then re-encrypts results to that public key, so only this browser session can read them.
 */
export async function authorizeDecryption(
  userAddress: string,
  contracts: string[],
  signTypedData: TypedDataSigner,
): Promise<DecryptionAuthorization> {
  const sorted = [...contracts].sort();

  if (
    cachedAuth &&
    cachedAuth.userAddress.toLowerCase() === userAddress.toLowerCase() &&
    sorted.every((c) => cachedAuth!.contracts.includes(c)) &&
    isAuthValid(cachedAuth)
  ) {
    return cachedAuth;
  }

  const instance = await getFhevmInstance();
  const { publicKey, privateKey } = instance.generateKeypair();

  const startTimestamp = Math.floor(Date.now() / 1000);
  const eip712 = instance.createEIP712(publicKey, sorted, startTimestamp, AUTH_DURATION_DAYS);

  // `EIP712Domain` is implied by the domain itself; wallets reject it as an explicit type.
  const { EIP712Domain: _domain, ...types } = eip712.types as Record<string, unknown>;

  const signature = await signTypedData({
    domain: eip712.domain as Record<string, unknown>,
    types,
    primaryType: "UserDecryptRequestVerification",
    message: eip712.message as Record<string, unknown>,
  });

  cachedAuth = {
    publicKey,
    privateKey,
    signature,
    contracts: sorted,
    userAddress,
    startTimestamp,
    durationDays: AUTH_DURATION_DAYS,
  };

  return cachedAuth;
}

function isAuthValid(auth: DecryptionAuthorization): boolean {
  const expiresAt = auth.startTimestamp + auth.durationDays * 86400;
  // Expire a minute early so a decryption started near the boundary cannot land after it.
  return Math.floor(Date.now() / 1000) < expiresAt - 60;
}

/** Forgets the decryption authorisation. Called on disconnect and on account change. */
export function clearDecryptionAuthorization(): void {
  cachedAuth = null;
}

/** True when a usable authorisation is already held, so the UI can skip the signing step. */
export function hasDecryptionAuthorization(userAddress: string): boolean {
  return (
    cachedAuth !== null &&
    cachedAuth.userAddress.toLowerCase() === userAddress.toLowerCase() &&
    isAuthValid(cachedAuth)
  );
}

/** The zero handle, which means "this value was never written". */
export const UNINITIALIZED_HANDLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * True when a handle was never written on-chain.
 *
 * The contract skips FHE work rather than storing an encrypted zero, so an untouched slot
 * reads back as the zero handle. The relayer cannot decrypt it — and should not be asked
 * to. Callers render these as a confidential zero instead of an error, which is what makes
 * a brand-new account show `0.00` rather than a failure.
 */
export function isUninitializedHandle(handle: string | undefined | null): boolean {
  return !handle || handle === UNINITIALIZED_HANDLE;
}

/**
 * Decrypts handles the caller is authorised to read.
 *
 * Uninitialised handles are answered locally as zero and never sent to the relayer.
 */
export async function userDecrypt(
  handles: { handle: string; contractAddress: string }[],
  auth: DecryptionAuthorization,
): Promise<Record<string, bigint | boolean>> {
  const results: Record<string, bigint | boolean> = {};

  const pending = handles.filter((entry) => {
    if (isUninitializedHandle(entry.handle)) {
      results[entry.handle] = 0n;
      return false;
    }
    return true;
  });

  if (pending.length === 0) return results;

  const instance = await getFhevmInstance();
  const decrypted = await instance.userDecrypt(
    pending.map((entry) => ({ handle: entry.handle, contractAddress: entry.contractAddress })),
    auth.privateKey,
    auth.publicKey,
    auth.signature,
    auth.contracts,
    auth.userAddress,
    auth.startTimestamp,
    auth.durationDays,
  );

  for (const [handle, value] of Object.entries(decrypted)) {
    results[handle] = value as bigint | boolean;
  }

  return results;
}

/**
 * A public decryption together with the KMS proof that authorises it.
 *
 * Most callers only want the value, but `ConfidentialWrapper.finalizeUnwrap` needs the
 * cleartext *and* the signatures over it — the contract re-verifies them with
 * `FHE.checkSignatures` before releasing any underlying tokens. Discarding the proof, as the
 * plain {publicDecrypt} does, would make the unwrap impossible to complete.
 */
export interface ProvenDecryption {
  /** Decrypted values, keyed by handle. */
  values: Record<string, bigint | boolean>;
  /** ABI-encoded cleartexts, in the order the handles were supplied. */
  abiEncodedClearValues: `0x${string}`;
  /** KMS signatures over (handles, cleartexts). */
  decryptionProof: `0x${string}`;
}

/**
 * Publicly decrypts handles and keeps the proof.
 *
 * Uses the wallet-free instance: public decryption is authorised by the on-chain ACL, not by
 * a signature, so it needs somewhere to read chain state and nothing more.
 */
export async function publicDecryptWithProof(handles: string[]): Promise<ProvenDecryption> {
  const usable = handles.filter((handle) => !isUninitializedHandle(handle));
  if (usable.length === 0) {
    throw new Error("Nothing to decrypt: every handle is uninitialised.");
  }

  const instance = await getPublicFhevmInstance();
  const result = await instance.publicDecrypt(usable);

  const values: Record<string, bigint | boolean> = {};
  for (const [handle, value] of Object.entries(result.clearValues)) {
    values[handle] = value as bigint | boolean;
  }

  return {
    values,
    abiEncodedClearValues: result.abiEncodedClearValues,
    decryptionProof: result.decryptionProof,
  };
}

/**
 * Decrypts handles the contract marked publicly decryptable.
 *
 * No wallet, no signature. This is how `/draws` shows a real prize pool to a visitor who
 * has connected nothing — the authorisation lives in the on-chain ACL, not in a session.
 */
export async function publicDecrypt(handles: string[]): Promise<Record<string, bigint | boolean>> {
  const results: Record<string, bigint | boolean> = {};

  const pending = handles.filter((handle) => {
    if (isUninitializedHandle(handle)) {
      results[handle] = 0n;
      return false;
    }
    return true;
  });

  if (pending.length === 0) return results;

  // Deliberately the wallet-free instance: `/draws` must work for a visitor who has not
  // connected anything.
  const instance = await getPublicFhevmInstance();

  // `publicDecrypt` returns the values alongside a KMS `decryptionProof`, unlike
  // `userDecrypt` which returns the map directly.
  const { clearValues } = await instance.publicDecrypt(pending);

  for (const [handle, value] of Object.entries(clearValues)) {
    results[handle] = value as bigint | boolean;
  }

  return results;
}
