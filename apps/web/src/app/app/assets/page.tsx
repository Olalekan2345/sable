"use client";

import { addresses } from "@sable/config";
import { useAccount } from "wagmi";

import { AssetRow } from "@/components/app/asset-row";
import { ConnectPrompt } from "@/components/app/connect-prompt";
import { Card, PageHeader, PrivacyNote, Skeleton } from "@/components/ui/primitives";
import { portfolioContracts, usePortfolio } from "@/lib/hooks/use-portfolio";

/**
 * Assets — what this wallet holds, on both sides of the wrapper.
 *
 * The page exists to make one distinction concrete. Every asset here has a public balance
 * that anybody can read and a shielded balance that nobody can, and putting them in adjacent
 * columns says more about what Sable does than a page of copy would.
 *
 * Balances are read for all of Zama's published confidential assets, not only the one the
 * vault custodies. A saver's holdings are their own business and do not stop at the edge of
 * this product; showing only the supported token would misrepresent the wallet.
 */
export default function AssetsPage() {
  const { isConnected } = useAccount();
  const { holdings, isLoading } = usePortfolio();

  if (!isConnected) {
    return (
      <ConnectPrompt
        title="Connect to see your assets"
        description="Shielded balances are ciphertext on-chain. Only the wallet that owns them can turn them back into numbers."
      />
    );
  }

  const authorizeFor = portfolioContracts();
  const vaultAsset = holdings.find((holding) => holding.isVaultAsset);

  return (
    <>
      <PageHeader
        eyebrow="Assets"
        title="What you hold"
        description="Public balances are visible to anyone. Shielded balances stay masked until you authorise a decryption — including from this page."
      />

      <div className="flex flex-col gap-4">
        <Card className="px-6 py-2 sm:px-7">
          {isLoading ? (
            <div className="flex flex-col gap-4 py-5">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            holdings.map((holding) => (
              <AssetRow
                key={holding.asset.address}
                holding={holding}
                authorizeFor={authorizeFor}
              />
            ))
          )}
        </Card>

        <PrivacyNote className="items-start">
          <span>
            Revealing asks your wallet to sign once, covering the assets listed here, and the
            authorisation expires by itself. It lets this browser session decrypt your own
            balances — nobody else gains anything, and the values are never sent anywhere.
          </span>
        </PrivacyNote>

        {/*
          The honest limit. The vault takes a single ERC-7984 in its constructor, so it
          custodies exactly one of these. Listing eight assets without saying which one can
          actually be saved would be a promise the deployment does not keep.
        */}
        <Card className="p-6">
          <p className="text-eyebrow mb-3">Which of these can be saved</p>
          <p className="text-[13px] leading-relaxed text-[var(--color-secondary)]">
            {vaultAsset ? (
              <>
                This deployment&rsquo;s vault custodies{" "}
                <span className="text-[var(--color-primary)]">{vaultAsset.asset.symbol}</span>{" "}
                only. The others can be held and shielded in this wallet, but not deposited into
                Sable.
              </>
            ) : (
              <>Sable is not deployed against any of these assets on this network yet.</>
            )}
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-tertiary)]">
            This is a deployment choice rather than a limit of the contracts — Sable&rsquo;s vault
            accepts any confidential token of this standard, and a separate vault can be deployed
            for each asset that should earn.
          </p>
          {addresses.sable ? (
            <p className="mt-3 font-mono text-[11px] text-[var(--color-quaternary)]">
              vault {addresses.sable}
            </p>
          ) : null}
        </Card>
      </div>
    </>
  );
}
