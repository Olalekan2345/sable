import { SEPOLIA_DEFAULT_ASSET } from "./assets";
import { ASSET_SYMBOL } from "./format";
import { DEPLOYMENT_KEY, SABLE_CHAIN_ID } from "./chain";
import { deployments } from "./generated";
import type { SableDeployment } from "./types";

/**
 * Resolves the deployed contract addresses.
 *
 * Precedence is: environment variables first, then the generated deployment record. The
 * env override exists so a reviewer can point the app at their own deployment without a
 * rebuild; the generated record is what makes a fresh clone work with no configuration at
 * all after `pnpm deploy:sepolia && pnpm sync:abis`.
 *
 * When neither is present the app does not invent addresses or fall back to a demo mode —
 * {isConfigured} returns false and every surface renders its "not deployed yet" state.
 */

export interface SableAddresses {
  sable: `0x${string}` | null;
  asset: `0x${string}` | null;
  yieldAdapter: `0x${string}` | null;
  /** The ERC-20 beneath a wrapped confidential asset, when there is one. */
  underlying: `0x${string}` | null;
  chainId: number;
  deployedAt: string | null;
  deploymentBlock: number | null;
}

function readEnv(key: string): string | undefined {
  // Guarded so this module is usable from the indexer (plain Node) as well as the browser.
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

function asAddress(value: string | undefined | null): `0x${string}` | null {
  if (!value) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  return value as `0x${string}`;
}

const record: SableDeployment | undefined = deployments[DEPLOYMENT_KEY];

export const addresses: SableAddresses = {
  sable:
    asAddress(readEnv("NEXT_PUBLIC_SABLE_ADDRESS")) ??
    asAddress(record?.contracts.Sable.address) ??
    null,
  asset:
    asAddress(readEnv("NEXT_PUBLIC_CONFIDENTIAL_ASSET_ADDRESS")) ??
    asAddress(record?.asset.address) ??
    null,
  yieldAdapter:
    asAddress(readEnv("NEXT_PUBLIC_YIELD_ADAPTER_ADDRESS")) ??
    asAddress(record?.contracts.YieldAdapter.address) ??
    null,
  // The ERC-20 beneath a wrapped asset. Null when Sable issued the asset itself, in which
  // case there is nothing to wrap and the token carries its own faucet.
  underlying: asAddress(record?.asset.underlying) ?? asAddress(SEPOLIA_DEFAULT_ASSET.underlying),
  chainId: Number(readEnv("NEXT_PUBLIC_CHAIN_ID") ?? SABLE_CHAIN_ID),
  deployedAt: record?.deployedAt ?? null,
  deploymentBlock: record?.contracts.Sable.blockNumber ?? null,
};

/** True when the app has a complete set of addresses to talk to. */
export function isConfigured(): boolean {
  return addresses.sable !== null && addresses.asset !== null && addresses.yieldAdapter !== null;
}

/**
 * Returns the addresses, or throws.
 *
 * For call sites that genuinely cannot proceed. UI code should branch on {isConfigured}
 * and render an empty state instead of throwing.
 */
export function requireAddresses(): Omit<SableAddresses, "deployedAt" | "deploymentBlock"> {
  if (!addresses.sable || !addresses.asset || !addresses.yieldAdapter) {
    throw new Error(
      "Sable is not configured. Run `pnpm deploy:sepolia && pnpm sync:abis`, or set " +
        "NEXT_PUBLIC_SABLE_ADDRESS, NEXT_PUBLIC_CONFIDENTIAL_ASSET_ADDRESS and " +
        "NEXT_PUBLIC_YIELD_ADAPTER_ADDRESS.",
    );
  }
  return {
    sable: addresses.sable,
    asset: addresses.asset,
    yieldAdapter: addresses.yieldAdapter,
    // May legitimately be null: an asset Sable issued itself has nothing beneath it.
    underlying: addresses.underlying,
    chainId: addresses.chainId,
  };
}

/** The full deployment record, when one has been generated. */
export const deployment: SableDeployment | null = record ?? null;

/**
 * True when the confidential asset is an ERC-20 wrapper the protocol does not control —
 * which is the case on Sepolia, where Sable custodies Zama's published `cUSDCMock`.
 *
 * The app branches on this in exactly one place: obtaining test tokens. A self-issued asset
 * has its own faucet; a wrapped one requires minting the underlying and wrapping it.
 */
export function isWrappedAsset(): boolean {
  if (record) return !record.asset.selfIssued && record.asset.underlying !== null;
  // With no deployment record, assume the Sepolia default, which is wrapped.
  return true;
}

/**
 * Symbol of the asset this deployment actually custodies.
 *
 * `ASSET_SYMBOL` is a compile-time default for a repository with no deployment record. Using
 * it to *label* a live deployment is wrong, and was: the vault holds `cUSDCMock`, while the
 * deposit field read `cUSDC` — a token that exists, is not this one, and is not a mock. On a
 * screen where somebody is about to authorise a transfer, naming the wrong asset is not a
 * cosmetic slip.
 */
export function assetSymbol(): string {
  return record?.asset.symbol ?? ASSET_SYMBOL;
}

/** How yield is funded in this deployment. */
export function adapterKind(): "reserve" | "mint" {
  return record?.parameters.adapterKind ?? "reserve";
}
