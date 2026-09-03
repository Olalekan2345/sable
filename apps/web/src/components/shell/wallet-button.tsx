"use client";

import { NETWORK_LABEL, truncateAddress } from "@sable/config";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAccount, useDisconnect } from "wagmi";

import { useWalletGate } from "@/lib/hooks/use-wallet-gate";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { clearDecryptionAuthorization } from "@/lib/fhevm/instance";
import { useNetworkGuard } from "@/lib/hooks/use-sable";
import { WalletModal, useWalletModal } from "./wallet-modal";
import { useConnectWallet } from "@/lib/hooks/use-connect-wallet";

/**
 * Wallet connection.
 *
 * Sable never opens with a full-screen "CONNECT WALLET" gate — the landing page, the draw
 * ledger and every explanatory page work with no wallet at all. This control is a quiet
 * affordance in the header until the moment a saver actually needs it.
 */
export function WalletButton({ className }: { className?: string }) {
  const { address, isConnected } = useAccount();
  const { isResolving } = useWalletGate();
  const { disconnect } = useDisconnect();
  const walletModal = useWalletModal();
  const connectWallet = useConnectWallet(walletModal.show);
  const { wrongNetwork, switchToSable, switching } = useNetworkGuard();

  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  /*
   * While the stored session is being restored, say nothing rather than "Connect wallet".
   *
   * This button is on every screen, so it was the most visible symptom of treating
   * `!isConnected` as "disconnected": it flipped to Connect on load and back to the address a
   * moment later, on every page, which looks exactly like a connection being dropped and
   * re-established. A disabled placeholder holds the same space and makes no claim.
   */
  if (isResolving) {
    return (
      <div className={cn("flex flex-col items-end gap-1", className)}>
        <Button size="sm" variant="secondary" disabled className="opacity-60">
          <span className="animate-pulse">Reconnecting…</span>
        </Button>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className={cn("flex flex-col items-end gap-1", className)}>
        <Button size="sm" variant="secondary" onClick={connectWallet}>
          Connect wallet
        </Button>
        <WalletModal open={walletModal.open} onClose={walletModal.hide} />
      </div>
    );
  }

  if (wrongNetwork) {
    return (
      <Button size="sm" variant="primary" loading={switching} onClick={switchToSable} className={className}>
        Switch to {NETWORK_LABEL.replace("Ethereum ", "")}
      </Button>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={cn(
          "inline-flex h-9 items-center gap-2.5 rounded-full border px-3.5",
          "border-[var(--color-hairline-strong)] bg-[var(--color-raised)]",
          "font-mono text-[11px] text-[var(--color-secondary)]",
          "transition-colors hover:border-[var(--color-hairline-accent)] hover:text-[var(--color-primary)]",
        )}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-verified)]" />
        {truncateAddress(address ?? "")}
      </button>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "absolute right-0 z-50 mt-2 w-[248px] overflow-hidden rounded-[var(--radius-md)]",
              "border border-[var(--color-hairline-strong)] bg-[var(--color-overlay)] p-1.5",
              "shadow-[0_24px_60px_-24px_rgba(0,0,0,0.95)]",
            )}
          >
            <div className="px-3 py-2.5">
              <p className="text-eyebrow mb-1.5">Connected</p>
              <p className="break-all font-mono text-[11px] text-[var(--color-secondary)]">{address}</p>
              <p className="mt-2 text-[11px] text-[var(--color-tertiary)]">{NETWORK_LABEL}</p>
            </div>

            <div className="rule-fade my-1" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                // Forget the decryption authorisation along with the connection: leaving it
                // behind would let the next session read balances without a wallet present.
                clearDecryptionAuthorization();
                disconnect();
                setMenuOpen(false);
              }}
              className={cn(
                "w-full rounded-[var(--radius-xs)] px-3 py-2.5 text-left text-[13px]",
                "text-[var(--color-secondary)] transition-colors",
                "hover:bg-[var(--color-elevated)] hover:text-[var(--color-primary)]",
              )}
            >
              Disconnect
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
