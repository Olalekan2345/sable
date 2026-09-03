/**
 * Zama's Confidential Wrapper.
 *
 * The minimal surface Sable needs from `ConfidentialWrapper` — the contract behind
 * `cUSDCMock` and its siblings. Only the functions Sable actually calls are declared; the
 * deployed contract has considerably more (observers, disclosure, pausing, governance).
 *
 * Every entry below was verified against the deployed implementation at
 * `0xae37b998d453e1fabe85dd46cf04295ca4a3af04` by checking the selector is present in its
 * bytecode, and the four ERC-165 interface ids were confirmed on-chain:
 *
 * ```
 * IERC7984              0x4958f2a4  true
 * IERC7984ERC20Wrapper  0x1f1c62b2  true
 * IERC1363Receiver      0x88a7ca5c  true
 * IERC165               0x01ffc9a7  true
 * ```
 */

export const confidentialWrapperAbi = [
  // --- wrapping ----------------------------------------------------------
  {
    type: "function",
    name: "wrap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },

  // --- unwrapping (two-step, asynchronous) -------------------------------
  //
  // `unwrap` burns the confidential amount, marks the resulting handle publicly
  // decryptable, and returns a request id that *is* that handle. `finalizeUnwrap` then
  // releases the underlying once the cleartext and its KMS proof are supplied.
  {
    type: "function",
    name: "unwrap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "encryptedAmount", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "finalizeUnwrap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "unwrapRequestId", type: "bytes32" },
      { name: "unwrapAmountCleartext", type: "uint64" },
      { name: "decryptionProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "unwrapAmount",
    stateMutability: "view",
    inputs: [{ name: "unwrapRequestId", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "unwrapRequester",
    stateMutability: "view",
    inputs: [{ name: "unwrapRequestId", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },

  // --- metadata ----------------------------------------------------------
  { type: "function", name: "underlying", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "rate", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  {
    type: "function",
    name: "maxTotalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    // A non-confidential approximation of total value shielded, derived from the wrapper's
    // own ERC-20 balance. Not the confidential supply, which cannot be read.
    type: "function",
    name: "inferredTotalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },

  // --- guards ------------------------------------------------------------
  //
  // Checked before wrapping or unwrapping so a saver gets a clear explanation rather than
  // an opaque revert. `isBlocked` consults both the wrapper's own denylist and the
  // underlying token's, and can itself revert if the underlying's check is misconfigured.
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  {
    type: "function",
    name: "isBlocked",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isBlockedOnWrapper",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isBlockedOnUnderlying",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },

  // --- events ------------------------------------------------------------
  {
    type: "event",
    name: "Wrap",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "roundedAmount", type: "uint256", indexed: false },
      { name: "encryptedWrappedAmount", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UnwrapRequested",
    inputs: [
      { name: "receiver", type: "address", indexed: true },
      { name: "unwrapRequestId", type: "bytes32", indexed: true },
      { name: "amount", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UnwrapFinalized",
    inputs: [
      { name: "receiver", type: "address", indexed: true },
      { name: "unwrapRequestId", type: "bytes32", indexed: true },
      { name: "encryptedAmount", type: "bytes32", indexed: false },
      { name: "cleartextAmount", type: "uint64", indexed: false },
    ],
  },
] as const;

/** ERC-165 interface ids published by Zama for the wrapper. */
export const WRAPPER_INTERFACE_IDS = {
  IERC7984: "0x4958f2a4",
  IERC7984ERC20Wrapper: "0x1f1c62b2",
  IERC1363Receiver: "0x88a7ca5c",
  IERC165: "0x01ffc9a7",
} as const;

/**
 * Why Sable uses `approve` + `wrap` rather than the single-transaction ERC-1363 path.
 *
 * Zama recommends `underlying.transferAndCall(wrapper, amount, data)` where the underlying
 * supports ERC-1363, since it avoids the approval entirely. The wrapper does implement
 * `IERC1363Receiver`.
 *
 * The default asset's underlying does not: `USDCMock`'s bytecode contains no
 * `transferAndCall` selector and it implements no ERC-165. So the two-transaction path is
 * the only one available, and Sable uses it rather than attempting a call that would revert.
 */
export const UNDERLYING_SUPPORTS_ERC1363 = false;

/**
 * The amount of underlying actually consumed by a wrap.
 *
 * The wrapper floors to a whole multiple of `rate` and refunds the remainder. Sable
 * pre-floors so the figure shown to the saver is the figure that moves — a refund arriving
 * as unexplained dust is worse than a slightly smaller headline number.
 */
export function floorToRate(amount: bigint, rate: bigint): bigint {
  if (rate <= 1n) return amount;
  return (amount / rate) * rate;
}

/** Confidential units produced by wrapping `underlyingAmount`. */
export function wrappedAmountFor(underlyingAmount: bigint, rate: bigint): bigint {
  return underlyingAmount / rate;
}

/** Underlying units released by unwrapping `confidentialAmount`. */
export function unwrappedAmountFor(confidentialAmount: bigint, rate: bigint): bigint {
  return confidentialAmount * rate;
}
