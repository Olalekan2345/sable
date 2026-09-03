/**
 * Zama's canonical confidential assets on Ethereum Sepolia.
 *
 * Source: Zama Protocol documentation, *Protocol Apps → Contract addresses → Testnet →
 * Sepolia*. **Every field below was read from the live chain**, not transcribed from the
 * table — including the ones the documentation does not list.
 *
 * Sable deliberately uses these rather than issuing an asset of its own. A savings protocol
 * that mints the very token it custodies invites an obvious question about where the money
 * comes from; using the ecosystem's published asset removes it. The vault takes any
 * `IERC7984` in its constructor, so this costs nothing architecturally.
 *
 * ## The rate, and why it is recorded here
 *
 * Every wrapper presents **6 decimals**, but the ERC-20 beneath it does not. Wrappers over an
 * 18-decimal token carry `rate = 1e12`; those over a 6-decimal token carry `rate = 1`.
 *
 * This is easy to get wrong in a way that fails quietly. To obtain `N` confidential units you
 * must mint `N × rate` of the underlying — using the confidential decimals instead would mint
 * a millionth of the intended amount against an 18-decimal token and wrap to **zero**. So the
 * rate is recorded, and every faucet path multiplies by it.
 */

export interface ConfidentialAsset {
  /** The ERC-7984 confidential wrapper. This is what Sable custodies. */
  address: `0x${string}`;
  /** The ERC-20 underlying the wrapper. Users mint this, then wrap it. */
  underlying: `0x${string}`;
  symbol: string;
  name: string;
  /** Decimals of the confidential token. Six on every published wrapper. */
  decimals: number;
  /** Decimals of the underlying ERC-20. Six or eighteen, depending on the asset. */
  underlyingDecimals: number;
  /**
   * Underlying units per confidential unit, as reported by `rate()`.
   * `1` for a 6-decimal underlying, `1e12` for an 18-decimal one.
   */
  rate: bigint;
  /** True when the underlying has an open, public mint. */
  publicFaucet: boolean;
  /** Per-call mint limit on the underlying, in whole tokens. */
  faucetLimit: number;
}

/**
 * Sable's default asset on Sepolia.
 *
 * cUSDC (Mock) is the natural choice for a savings product: dollar-denominated, an open
 * faucet, and `rate == 1` — so the underlying and the confidential token share six decimals
 * and there is no scaling anywhere in the stack.
 */
export const SEPOLIA_DEFAULT_ASSET: ConfidentialAsset = {
  address: "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639",
  underlying: "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF",
  symbol: "cUSDCMock",
  name: "Confidential USDC (Mock)",
  decimals: 6,
  underlyingDecimals: 6,
  rate: 1n,
  publicFaucet: true,
  faucetLimit: 1_000_000,
};

/**
 * Every confidential asset Zama publishes on Sepolia.
 *
 * Sable can custody any of them — pass `--asset <address>` to `deploy:sable`. The vault code
 * is identical for all; only the faucet arithmetic depends on `rate`.
 */
export const SEPOLIA_ASSETS: readonly ConfidentialAsset[] = [
  SEPOLIA_DEFAULT_ASSET,
  {
    address: "0x4E7B06D78965594eB5EF5414c357ca21E1554491",
    underlying: "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0",
    symbol: "cUSDTMock",
    name: "Confidential USDT (Mock)",
    decimals: 6,
    underlyingDecimals: 6,
    rate: 1n,
    publicFaucet: true,
    faucetLimit: 1_000_000,
  },
  {
    address: "0xe4FcF848739845BC81Dee1d5352cf3844F0a60C7",
    underlying: "0x24377AE4AA0C45ecEe71225007f17c5D423dd940",
    symbol: "cXAUtMock",
    name: "Confidential XAUt (Mock)",
    decimals: 6,
    underlyingDecimals: 6,
    rate: 1n,
    publicFaucet: true,
    faucetLimit: 1_000_000,
  },
  {
    address: "0x46208622DA27d91db4f0393733C8BA082ed83158",
    underlying: "0xff54739b16576FA5402F211D0b938469Ab9A5f3F",
    symbol: "cWETHMock",
    name: "Confidential WETH (Mock)",
    decimals: 6,
    underlyingDecimals: 18,
    rate: 1_000_000_000_000n,
    publicFaucet: true,
    faucetLimit: 1_000_000,
  },
  {
    address: "0xaa5612FA27c927a0c7961f5AEFEE5ba3A0F9C891",
    underlying: "0xFf021fB13cA64e5354c62c954b949a88cfDEb25E",
    symbol: "cBRONMock",
    name: "Confidential BRON (Mock)",
    decimals: 6,
    underlyingDecimals: 18,
    rate: 1_000_000_000_000n,
    publicFaucet: true,
    faucetLimit: 1_000_000,
  },
  {
    address: "0xf2D628d2598aF4eAF94CB76a437Ff86CA78FfbFB",
    underlying: "0x75355a85c6FB9df5f0C80FF54e8747EEe9a0BF57",
    symbol: "cZAMAMock",
    name: "Confidential ZAMA (Mock)",
    decimals: 6,
    underlyingDecimals: 18,
    rate: 1_000_000_000_000n,
    publicFaucet: true,
    faucetLimit: 1_000_000,
  },
  {
    address: "0xfCE5c7069c5525eF6c8C2b2E35A745bA20a2F7CC",
    underlying: "0x93c931278A2aad1916783F952f94276eA5111442",
    symbol: "ctGBPMock",
    name: "Confidential tGBP (Mock)",
    decimals: 6,
    underlyingDecimals: 18,
    rate: 1_000_000_000_000n,
    publicFaucet: true,
    faucetLimit: 1_000_000,
  },
  {
    // The only non-mock wrapper. Its underlying has restricted minting — verified on-chain:
    // a public `mint` call reverts — so it cannot be used for a self-service demo.
    address: "0x167DC962808B32CFFFc7e14B5018c0bE06A3A208",
    underlying: "0xf6Ef9ADB61A48E29E36bc873070A46A3D2667ff3",
    symbol: "ctGBP",
    name: "Confidential tGBP",
    decimals: 6,
    underlyingDecimals: 18,
    rate: 1_000_000_000_000n,
    publicFaucet: false,
    faucetLimit: 0,
  },
] as const;

/** Zama's confidential-wrapper registry on Sepolia. */
export const SEPOLIA_WRAPPERS_REGISTRY = "0x2f0750Bbb0A246059d80e94c454586a7F27a128e" as const;

/** Returns the Zama asset matching `address`, if it is one of them. */
export function findZamaAsset(address: string | null | undefined): ConfidentialAsset | null {
  if (!address) return null;
  const lower = address.toLowerCase();
  return SEPOLIA_ASSETS.find((asset) => asset.address.toLowerCase() === lower) ?? null;
}

/**
 * Underlying units needed to obtain `confidentialAmount` of the wrapped token.
 *
 * The multiplication by `rate` is the whole point of this helper. Minting the confidential
 * amount directly works by accident on a `rate == 1` asset and wraps to zero on any other.
 */
export function underlyingFor(confidentialAmount: bigint, rate: bigint): bigint {
  return confidentialAmount * rate;
}
