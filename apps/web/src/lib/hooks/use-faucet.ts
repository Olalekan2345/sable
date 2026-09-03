"use client";

import { SABLE_CHAIN_ID, deployment } from "@sable/config";
import { useCallback, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";

import { WRONG_NETWORK_MESSAGE, toTxError } from "./use-confidential-tx";
import { useEnsureChain } from "./use-sable";

/**
 * Obtaining the test token the pool accepts.
 *
 * ## What this actually calls
 *
 * `mint` on **Zama's** `USDCMock` — the ERC-20 their published `cUSDCMock` wrapper names as
 * its own underlying, verified by asking the deployed vault for its asset and that wrapper for
 * its underlying rather than by transcribing an address from a table. Both contracts had
 * bytecode long before Sable's first deployment, and the mint is permissionless: simulating it
 * from an address with no balance and no role succeeds.
 *
 * So Sable still issues nothing. This is a convenience wrapper around a public mint on someone
 * else's token, which is exactly what the `faucet` hardhat task does — the same call that
 * funded the yield reserve.
 *
 * ## Why it is capped
 *
 * Zama left the mint unrestricted, which is reasonable for a testnet mock and unreasonable as
 * a button in a savings product. Ten thousand is enough to shield, deposit, and still have
 * some left to unwrap with; more would make the interface read as a money printer rather than
 * a faucet.
 */

/** Whole tokens handed out per click. */
export const FAUCET_AMOUNT = 10_000;

const mintAbi = [
  {
    name: "mint",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export function useFaucet() {
  const { address } = useAccount();
  const config = useConfig();
  const ensureChain = useEnsureChain();

  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const underlying = deployment?.asset.underlying as `0x${string}` | undefined;
  const decimals = deployment?.asset.underlyingDecimals ?? 6;

  const claim = useCallback(async (): Promise<`0x${string}` | null> => {
    if (!underlying || !address) return null;

    setBusy(true);
    setError(null);

    try {
      if (!(await ensureChain())) {
        setError(WRONG_NETWORK_MESSAGE);
        return null;
      }

      const amount = BigInt(FAUCET_AMOUNT) * 10n ** BigInt(decimals);
      const hash = await writeContract(config, {
        address: underlying,
        abi: mintAbi,
        functionName: "mint",
        args: [address, amount],
        chainId: SABLE_CHAIN_ID,
      });

      await waitForTransactionReceipt(config, { hash, chainId: SABLE_CHAIN_ID });
      return hash;
    } catch (caught) {
      setError(toTxError(caught));
      return null;
    } finally {
      setBusy(false);
    }
  }, [address, config, decimals, ensureChain, underlying]);

  return { claim, isBusy, error, available: Boolean(underlying && address) };
}
