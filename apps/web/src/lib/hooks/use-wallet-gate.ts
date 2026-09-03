"use client";

import { useAccount } from "wagmi";

/**
 * Connected, disconnected, or not yet known.
 *
 * `useAccount().isConnected` collapses two different situations into one falsy value: nobody
 * is connected, and wagmi has not finished restoring the session it already has. Treating
 * them the same is what made the app announce "Connect your wallet" to somebody who was
 * already connected — the message flashes on load and again on any navigation that remounts a
 * page, and it reads as the app dropping the connection.
 *
 * Storage is only read on the client, because `localStorage` does not exist during server
 * rendering. So the first client render *always* begins disconnected and settles a moment
 * later. That gap is normal and unavoidable; presenting it as a disconnection is the bug.
 *
 * `isResolving` covers `reconnecting` — restoring a stored session — and `connecting`, which
 * is a connection in flight. Both mean *wait*, and neither means *no*.
 */
export function useWalletGate() {
  const { isConnected, status } = useAccount();

  return {
    isConnected,
    isResolving: status === "reconnecting" || status === "connecting",
    status,
  };
}
