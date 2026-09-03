"use client";

import { useAccount } from "wagmi";

import { ModeCard, NextDrawCard } from "@/components/app/mode-card";
import { SavingsCard } from "@/components/app/savings-card";
import { ConnectPrompt } from "@/components/app/connect-prompt";
import { RewardsSummary } from "@/components/app/rewards-summary";
import { AssetsSummary } from "@/components/app/assets-summary";
import { PageHeader } from "@/components/ui/primitives";

/**
 * The dashboard.
 *
 * Three questions, answered in order: what do I have, what is it doing, and what is coming
 * next. Everything private stays masked until the saver asks for it.
 */
export default function DashboardPage() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return (
      <ConnectPrompt
        title="Your savings live behind your wallet"
        description="Sable holds your balance as ciphertext on Ethereum Sepolia. Connect the wallet that owns the position to decrypt it — only that wallet can."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Your position"
        description="Everything below is encrypted on-chain. Values appear only when you authorise them."
      />

      <div className="flex flex-col gap-4">
        <SavingsCard />

        <div className="grid gap-4 md:grid-cols-2">
          <ModeCard />
          <NextDrawCard />
        </div>

        <RewardsSummary />
        <AssetsSummary />
      </div>
    </>
  );
}
