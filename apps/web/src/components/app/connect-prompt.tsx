"use client";


import { SableMark } from "@/components/brand/logo";
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

  return (
    <Card className="mx-auto max-w-[520px] p-9 text-center sm:p-11">
      <div className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-hairline)] bg-[var(--color-raised)]">
        <SableMark className="h-6 w-6" />
      </div>

      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--color-primary)]">
        {title}
      </h1>
      <p className="mx-auto mt-4 max-w-[42ch] text-[14px] leading-relaxed text-[var(--color-secondary)]">
        {description}
      </p>

      <div className="mt-8 flex flex-col gap-3">
        <Button size="lg" fullWidth onClick={connectWallet}>
          Connect wallet
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
