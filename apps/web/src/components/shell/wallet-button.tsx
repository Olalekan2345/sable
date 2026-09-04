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

  if (!isConnected) {
    return (
      <div className={cn("flex flex-col items-end gap-1", className)}>
        {/*
          One button whether resolving or disconnected.
          
          Rendering a separate "Reconnecting…" button unmounted this one and mounted another
          milliseconds later, on every page. A click in that gap lands on a detaching element
          and does nothing — the header button is the most-pressed control in the product, so
          it must never be swapped underneath a cursor. Only its label and enabled state
          change now.
        */}
        <Button
          size="sm"
          variant="secondary"
          onClick={connectWallet}
          className={isResolving ? "opacity-70" : undefined}
        >
          {isResolving ? "Reconnecting…" : "Connect wallet"}
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
      {/*
        Deliberately not as loud as the primary beside it.
        
        This sits next to the faucet call to action, which is the thing a newcomer must find.
        Matching its weight would leave two controls competing and neither leading. So the
        treatment here is *status* rather than emphasis: the glow is the connection's own
        colour, and it says "live" instead of "press me".
      */}
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className={cn(
          "group inline-flex h-9 items-center gap-2.5 rounded-full border px-3.5",
          "border-[rgba(94,224,138,0.22)]",
          "bg-[linear-gradient(180deg,var(--color-elevated),var(--color-raised))]",
          "font-mono text-[11px] text-[var(--color-secondary)]",
          "shadow-[0_0_0_1px_rgba(94,224,138,0.06),0_2px_12px_-6px_rgba(94,224,138,0.45)]",
          "transition-[color,border-color,box-shadow,transform] duration-200",
          "hover:border-[rgba(94,224,138,0.45)] hover:text-[var(--color-primary)]",
          "hover:shadow-[0_0_0_1px_rgba(94,224,138,0.16),0_6px_20px_-6px_rgba(94,224,138,0.75)]",
        )}
      >
        {/*
          A live indicator, not a decoration: the halo pulses only while a wallet is actually
          connected, which is the one thing this control exists to report. `motion-safe`
          rather than a JS check, so the preference is honoured by the browser and the dot
          still shows without it.
        */}
        <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-verified)] opacity-70 motion-safe:animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-verified)]" />
        </span>

        {truncateAddress(address ?? "")}

        {/*
          The pill opens a menu and gave no sign of it. A chevron that turns is the smallest
          honest affordance for that.
        */}
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={cn(
            "h-3 w-3 shrink-0 text-[var(--color-quaternary)] transition-transform duration-200",
            "group-hover:text-[var(--color-tertiary)]",
            menuOpen && "rotate-180",
          )}
        >
          <path
            d="M3 4.5 L6 7.5 L9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
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
