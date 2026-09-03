import { sepolia } from "viem/chains";

/**
 * Sable runs on Ethereum Sepolia, because that is where the Zama Protocol's coprocessor,
 * KMS and relayer are deployed. The chain is not configurable at runtime: a confidential
 * app pointed at a chain without an FHEVM coprocessor would fail in ways that look like
 * application bugs rather than a misconfiguration.
 */
export const SABLE_CHAIN = sepolia;
export const SABLE_CHAIN_ID = sepolia.id;

/** Human-readable network name used throughout the UI. */
export const NETWORK_LABEL = "Ethereum Sepolia";

/** Hardhat network key whose deployment record the app should read. */
export const DEPLOYMENT_KEY = "sepolia";

const EXPLORER_BASE = "https://sepolia.etherscan.io";

export const explorer = {
  base: EXPLORER_BASE,
  tx: (hash: string) => `${EXPLORER_BASE}/tx/${hash}`,
  address: (address: string) => `${EXPLORER_BASE}/address/${address}`,
  block: (block: number | bigint) => `${EXPLORER_BASE}/block/${block}`,
} as const;

/**
 * The Zama Protocol contracts Sable depends on, on Sepolia.
 *
 * These are **not** used to configure the app — the Relayer SDK's own `SepoliaConfig`
 * export is the source of truth at runtime. They are listed here so the `/security` page
 * can show a saver exactly which system contracts are involved, with working explorer
 * links, rather than asking them to take it on faith.
 */
export const ZAMA_CONTRACTS = [
  {
    name: "ACL",
    address: "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D",
    description: "Decides which address may decrypt which ciphertext.",
  },
  {
    name: "FHEVM Executor",
    address: "0x92C920834Ec8941d2C77D188936E1f7A6f49c127",
    description: "Runs homomorphic operations requested by contracts.",
  },
  {
    name: "KMS Verifier",
    address: "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A",
    description: "Verifies key-management signatures for decryption.",
  },
  {
    name: "Input Verifier",
    address: "0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0",
    description: "Checks the zero-knowledge proof attached to every encrypted input.",
  },
] as const;

/** Relayer endpoint, shown on the security page for transparency. */
export const ZAMA_RELAYER_URL = "https://relayer.testnet.zama.org";
