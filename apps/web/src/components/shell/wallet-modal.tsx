"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useConnect, type Connector } from "wagmi";

import { SableMark } from "@/components/brand/logo";
import { LockIcon } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { hasWalletConnect } from "@/lib/wagmi";

/**
 * The wallet picker.
 *
 * ## Why this exists rather than a one-click connect
 *
 * The previous implementation called `connect({ connector: connectors[0] })` — the generic
 * injected connector. That works only when exactly one wallet is installed. With two or
 * more, the extensions contest `window.ethereum` and the connection either fails or opens
 * the wrong wallet, with no way for the saver to choose.
 *
 * wagmi implements **EIP-6963**, where each installed wallet announces itself with a name
 * and an icon. This lists every one of them, so choosing is explicit.
 *
 * ## Why not RainbowKit or ConnectKit
 *
 * Both were evaluated and neither is installable here: RainbowKit peers `wagmi@^2.9.0` and
 * ConnectKit peers React 17/18, while this app runs wagmi 3 and React 19. Rather than
 * downgrade the whole stack for a modal, the picker is built on wagmi's own discovery —
 * which is the same mechanism those kits use underneath.
 */
/**
 * A store that never changes after hydration.
 *
 * `window.ethereum` is injected by an extension before the page scripts run, so there is
 * nothing to subscribe to — the value is fixed for the life of the document. The empty
 * subscribe satisfies the contract without leaving a listener behind.
 */
const subscribeToNothing = () => () => {};

const getHasLegacyProvider = () => Boolean((window as { ethereum?: unknown }).ethereum);

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { connect, connectors, isPending, error, reset } = useConnect();
  const reduceMotion = useReducedMotion();

  const [attempted, setAttempted] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  /**
   * Two facts that only exist in the browser: whether we have hydrated, and whether a legacy
   * `window.ethereum` is present at all.
   *
   * Both are read through `useSyncExternalStore` rather than written into state from an
   * effect. The server snapshot is what makes it safe — React renders `false` on the server
   * and during hydration, then switches to the real value, so the markup never disagrees
   * with the HTML the server sent.
   */
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  const hasLegacyProvider = useSyncExternalStore(
    subscribeToNothing,
    getHasLegacyProvider,
    () => false,
  );

  /**
   * Discovered wallets, deduplicated.
   *
   * When EIP-6963 finds anything, the generic "Injected" row is dropped: it would connect
   * to one of the very wallets already listed by name, so offering both invites the saver
   * to pick the ambiguous option.
   */
  const wallets = useMemo(() => {
    const discovered = connectors.filter((c) => c.id !== "injected" && c.type !== "walletConnect");
    const generic = connectors.filter((c) => c.id === "injected");
    const wc = connectors.filter((c) => c.type === "walletConnect");

    // The generic connector is a fallback for wallets that predate EIP-6963. It is offered
    // only when discovery found nothing *and* a legacy provider is actually present —
    // otherwise it renders as a wallet that does not exist and fails on click, which is
    // worse than honestly reporting that nothing is installed.
    const fallback = discovered.length === 0 && hasLegacyProvider ? generic : [];

    const seen = new Set<string>();
    const unique = [...discovered, ...fallback].filter((c) => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { installed: unique, walletConnect: wc };
  }, [connectors, hasLegacyProvider]);

  const nothingInstalled = wallets.installed.length === 0;

  const handleConnect = useCallback(
    (connector: Connector) => {
      setAttempted(connector.uid);
      reset();
      connect(
        { connector },
        {
          onSuccess: () => {
            setAttempted(null);
            onClose();
          },
          onError: () => setAttempted(null),
        },
      );
    },
    [connect, onClose, reset],
  );

  // Focus management: remember what was focused, move into the dialog, restore on close.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    }, 50);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Trap focus inside the dialog.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!mounted) return null;

  /**
   * Rendered through a portal into `document.body`.
   *
   * This is not tidiness — it is required for correctness. The header that hosts one of the
   * connect buttons uses `backdrop-blur`, and any `backdrop-filter` establishes a containing
   * block for `position: fixed` descendants. Rendered in place, the dialog anchored itself to
   * the 64px-tall header instead of the viewport and sat mostly off-screen, leaving wallet
   * rows visible but impossible to click.
   */
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center">
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-[rgba(6,7,4,0.82)] backdrop-blur-sm"
            initial={reduceMotion ? undefined : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-modal-title"
            initial={reduceMotion ? undefined : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "surface-card relative z-10 w-full max-w-[420px] p-6 sm:p-7",
              "rounded-b-none sm:rounded-b-[var(--radius-lg)]",
              // The dialog must scroll. As a bottom sheet on a phone it can easily exceed the
              // viewport once several wallets are installed, and without this the rows below
              // the fold are visible but untappable — the browser refuses to click an element
              // it cannot bring on-screen.
              "max-h-[88dvh] overflow-y-auto overscroll-contain",
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <SableMark className="mb-4 h-6 w-6" />
                <h2
                  id="wallet-modal-title"
                  className="text-[19px] font-semibold tracking-[-0.02em] text-[var(--color-primary)]"
                >
                  Connect a wallet
                </h2>
                <p className="mt-2 max-w-[34ch] text-[13px] leading-relaxed text-[var(--color-secondary)]">
                  Your wallet is your private access key. Nothing is shared by connecting.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-m-1.5 rounded p-1.5 text-[var(--color-quaternary)] transition-colors hover:text-[var(--color-primary)]"
              >
                <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              {nothingInstalled ? (
                <NoWalletFound />
              ) : (
                wallets.installed.map((connector) => (
                  <WalletRow
                    key={connector.uid}
                    connector={connector}
                    pending={isPending && attempted === connector.uid}
                    onSelect={() => handleConnect(connector)}
                  />
                ))
              )}

              {wallets.walletConnect.map((connector) => (
                <WalletRow
                  key={connector.uid}
                  connector={connector}
                  label="WalletConnect"
                  hint="Scan with a phone wallet"
                  pending={isPending && attempted === connector.uid}
                  onSelect={() => handleConnect(connector)}
                />
              ))}
            </div>

            {!hasWalletConnect && !nothingInstalled ? (
              <p className="mt-4 text-[11px] leading-relaxed text-[var(--color-quaternary)]">
                Phone wallets need a WalletConnect project id. Set{" "}
                <span className="font-mono">NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</span> to enable
                them.
              </p>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-[var(--radius-sm)] border border-[rgba(255,107,107,0.28)] bg-[rgba(255,107,107,0.05)] p-3">
                <p className="text-[12px] text-[var(--color-danger)]">
                  {describeConnectError(error)}
                </p>
              </div>
            ) : null}

            <div className="rule-fade my-5" />

            <p className="flex items-center gap-2 text-[11px] text-[var(--color-tertiary)]">
              <LockIcon className="h-3 w-3 shrink-0 text-[var(--color-accent)]" />
              Sable never sees your keys, and connecting reveals no balance.
            </p>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function WalletRow({
  connector,
  pending,
  onSelect,
  label,
  hint,
}: {
  connector: Connector;
  pending: boolean;
  onSelect: () => void;
  label?: string;
  hint?: string;
}) {
  const name = label ?? connector.name;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={pending}
      className={cn(
        "group flex items-center gap-3.5 rounded-[var(--radius-md)] border px-4 py-3.5 text-left",
        "border-[var(--color-hairline)] bg-[var(--color-inset)]",
        "transition-colors duration-200",
        "hover:border-[var(--color-hairline-accent)] hover:bg-[var(--color-elevated)]",
        "disabled:opacity-60",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[var(--color-elevated)]">
        {connector.icon ? (
          // Wallet-supplied icon, usually an inline data URI from EIP-6963.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={connector.icon} alt="" className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden="true" className="text-[13px] text-[var(--color-tertiary)]">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-[var(--color-primary)]">{name}</span>
        {hint ? (
          <span className="mt-0.5 block text-[11px] text-[var(--color-tertiary)]">{hint}</span>
        ) : null}
      </span>

      {pending ? (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-[var(--color-accent)] border-t-transparent"
        />
      ) : (
        <span
          aria-hidden="true"
          className="shrink-0 text-[var(--color-quaternary)] transition-transform duration-200 group-hover:translate-x-0.5"
        >
          →
        </span>
      )}
    </button>
  );
}

/** Shown when EIP-6963 discovery finds nothing installed. */
function NoWalletFound() {
  return (
    <div className="surface-inset p-5">
      <p className="text-[13px] font-medium text-[var(--color-primary)]">No wallet detected</p>
      <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-secondary)]">
        Sable needs a browser wallet on Ethereum Sepolia. Install one, then reopen this dialog.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          { name: "MetaMask", href: "https://metamask.io/download/" },
          { name: "Rabby", href: "https://rabby.io/" },
          { name: "Coinbase Wallet", href: "https://www.coinbase.com/wallet/downloads" },
        ].map((wallet) => (
          <a
            key={wallet.name}
            href={wallet.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "rounded-full border border-[var(--color-hairline-strong)] px-3 py-1.5",
              "text-[11px] text-[var(--color-secondary)] transition-colors",
              "hover:border-[var(--color-hairline-accent)] hover:text-[var(--color-primary)]",
            )}
          >
            {wallet.name} ↗
          </a>
        ))}
      </div>
    </div>
  );
}

/** Connection failures, in language that says what to do next. */
export function describeConnectError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("user rejected") || lower.includes("user denied") || lower.includes("rejected the request")) {
    return "Connection declined. Nothing was shared.";
  }
  if (lower.includes("already pending") || lower.includes("request already")) {
    return "Your wallet already has a pending request — open the extension and respond to it.";
  }
  if (lower.includes("connectornotfound") || lower.includes("provider not found")) {
    return "That wallet is no longer available. Refresh the page and try again.";
  }
  if (lower.includes("chain") && lower.includes("not configured")) {
    return "Add Ethereum Sepolia to your wallet, then connect again.";
  }
  return "Could not connect to that wallet. Try again, or pick a different one.";
}

/** Opens the picker and keeps its state, so several call sites can share one dialog. */
export function useWalletModal() {
  const [open, setOpen] = useState(false);
  return {
    open,
    show: useCallback(() => setOpen(true), []),
    hide: useCallback(() => setOpen(false), []),
    setOpen,
  };
}
