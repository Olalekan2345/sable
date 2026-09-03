"use client";

import { deployment, isWrappedAsset } from "@sable/config";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { FAUCET_AMOUNT, useFaucet } from "@/lib/hooks/use-faucet";

/**
 * Test tokens, always within reach.
 *
 * The same call as {FaucetCard}, promoted out of the empty state and into the app bar. The
 * card explains *why* a wallet needs the underlying at all and belongs where someone first
 * hits that wall; this exists because the explanation is only needed once and the tokens are
 * needed repeatedly. Hidden behind an empty balance, it vanished the moment it had worked —
 * which is precisely when somebody trying the flow a second time goes looking for it.
 *
 * There is no per-wallet limit to reproduce here: Zama's mock is permissionless with no
 * cooldown, so the cap is per press. Pressing it five times mints five times.
 *
 * Rendered only on a deployment that wraps somebody else's token. Where Sable issued the asset
 * itself there would be nothing external to mint, and a faucet in the app bar of a savings
 * product needs the justification that this one has.
 */
export function FaucetButton() {
  const { isConnected } = useAccount();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const { claim, isBusy, error, available } = useFaucet();

  const symbol = deployment?.asset.symbol.replace(/^c/, "") ?? "tokens";

  if (!isConnected || !isWrappedAsset() || !deployment?.asset.underlying) return null;

  const onClaim = async () => {
    const hash = await claim();

    if (hash) {
      notify({
        title: `${FAUCET_AMOUNT.toLocaleString()} ${symbol} received`,
        description: `In your wallet now — press again for more. Your wallet app will not list ${symbol} unless you add it as a custom token, but Sable reads it straight from the chain.`,
        tone: "verified",
        txHash: hash,
      });

      // Refresh every balance on screen. The button does not know which page it is sitting
      // above, so invalidating broadly is both simpler and more reliable than threading a
      // refetch callback down from each one.
      await queryClient.invalidateQueries();
      return;
    }

    if (error) {
      notify({ title: "Could not get tokens", description: error, tone: "danger" });
    }
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClaim}
      loading={isBusy}
      disabled={!available}
      className="shrink-0"
      /*
       * Named explicitly, because the visible text shortens on a narrow bar and the accessible
       * name would otherwise shorten with it. A sighted visitor loses two words; a screen
       * reader user would have lost the meaning, hearing "Tokens" with no verb in it.
       */
      aria-label="Get test tokens"
    >
      <span className="hidden sm:inline">Get test tokens</span>
      <span aria-hidden="true" className="sm:hidden">
        Tokens
      </span>
    </Button>
  );
}
