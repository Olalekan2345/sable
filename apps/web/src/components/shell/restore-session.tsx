"use client";

import { useEffect, useRef } from "react";
import { useAccount, useConfig, useConnectors } from "wagmi";
import { reconnect } from "wagmi/actions";

/**
 * Retries the reconnect that lost a race with wallet discovery.
 *
 * `WagmiProvider` attempts one reconnect when it mounts, using the connector id it stored last
 * time. Browser wallets are found through **EIP-6963**, which is asynchronous: the page asks,
 * and each extension answers on its own schedule. So on a fresh page load the attempt can run
 * before the connector it is looking for exists — and a reconnect that cannot find its
 * connector does not wait. It fails, wagmi clears `connections`, and nothing tries again.
 *
 * The symptom is a session that survives client-side navigation and dies on any real page
 * load: the address reappears as "Connect wallet", while the storage still holds a perfectly
 * good connection and AppKit still believes it is connected. Two sources of truth disagreeing
 * is what makes it look like a bug in the wallet rather than in the app.
 *
 * Watching `useConnectors()` is the fix: the list grows as wallets announce themselves, so the
 * effect re-runs when the connector actually arrives and reconnects then.
 *
 * ## Why this is safe to run
 *
 * `reconnect` only ever restores a connection this browser already authorised — it consults
 * stored state and never opens a wallet prompt. Somebody who has genuinely disconnected has no
 * stored connection to restore, so this does nothing for them, and the ref makes sure a
 * connected session is never re-attempted underneath itself.
 */
export function RestoreSession() {
  const config = useConfig();
  const connectors = useConnectors();
  const { status } = useAccount();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    // `reconnecting` means the provider's own attempt is still in flight; let it finish.
    if (status !== "disconnected") return;
    if (connectors.length === 0) return;

    attempted.current = true;
    // Failure here is not worth surfacing: it means there was nothing to restore, which is
    // exactly the state the interface is already showing.
    void reconnect(config).catch(() => {});
  }, [config, connectors, status]);

  return null;
}
