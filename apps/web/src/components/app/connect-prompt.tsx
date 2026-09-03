"use client";


import { SableMark } from "@/components/brand/logo";
import { useWalletGate } from "@/lib/hooks/use-wallet-gate";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, PrivacyNote } from "@/components/ui/primitives";
import { WalletModal, useWalletModal } from "@/components/shell/wallet-modal";
import { useConnectWallet } from "@/lib/hooks/use-connect-wallet";

/**
 * The connect prompt.
 *
 * Not a wall. It explains *why* a wallet is needed — it is the decryption key, not merely
 * a login — and keeps a route back to the parts of Sable that need no wallet at all.
 */
export function ConnectPrompt({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const walletModal = useWalletModal();
  const connectWallet = useConnectWallet(walletModal.show);
  const { isResolving } = useWalletGate();

  /*
   * Do not ask for a wallet that may already be connected.
   *
   * Every gated page renders this whenever `isConnected` is false, and that is false in two
   * unrelated situations: nobody is connected, and wagmi has not finished restoring the
   * session it already holds. Storage can only be read on the client, so the first client
   * render always begins disconnected and settles a moment later — which meant a connected
   * saver was told to connect on load and on any navigation that remounted a page. It read as
   * the app dropping the connection, and it was the single most alarming thing in the product
   * precisely because it looked like state loss.
   *
   * Waiting is the honest answer while the answer is unknown. Restoring resolves in
   * milliseconds when it succeeds, so this is a brief placeholder rather than a spinner
   * somebody has to sit through — and when it fails, the prompt below appears as it always
   * did.
   */
  return (
    <Card className="mx-auto max-w-[520px] p-9 text-center sm:p-11">
      <div className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-hairline)] bg-[var(--color-raised)]">
        <SableMark className="h-6 w-6" />
      </div>

      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--color-primary)]">
        {isResolving ? "Restoring your session…" : title}
      </h1>
      <p className="mx-auto mt-4 max-w-[42ch] text-[14px] leading-relaxed text-[var(--color-secondary)]">
        {isResolving
          ? "This browser has a wallet connected. Reading it back from storage now."
          : description}
      </p>

      <div className="mt-8 flex flex-col gap-3">
        {/*
          One button, always mounted.
          
          An earlier version returned a different card while the session was being restored,
          which unmounted this button and mounted a new one a moment later. That is not merely
          a flash: a click landing in the gap hits an element that is being detached and does
          nothing, so the first press of Connect could silently fail. Varying the state of a
          single element keeps the DOM stable and the click target real.
        */}
        {/*
          Not disabled while resolving. Restoring normally takes milliseconds, but a status
          that stuck would leave the only way into the product permanently unclickable, and
          connecting during a restore is harmless. The label says what is happening; the
          button still works.
        */}
        <Button size="lg" fullWidth onClick={connectWallet}>
          {isResolving ? "Reconnecting…" : "Connect wallet"}
        </Button>

        <ButtonLink href="/draws" variant="ghost" size="md" fullWidth>
          Browse the public draw ledger instead
        </ButtonLink>
      </div>

      <div className="rule-fade my-7" />

      <PrivacyNote className="justify-center">
        Your wallet is your private access key to Sable.
      </PrivacyNote>

      <WalletModal open={walletModal.open} onClose={walletModal.hide} />
    </Card>
  );
}
