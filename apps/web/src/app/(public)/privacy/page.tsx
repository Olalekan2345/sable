import type { Metadata } from "next";

import { Comparison, ContentPage, ContentSection, List, Note, P } from "@/components/content/prose";
import { InlineLink } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Privacy model",
  description:
    "Exactly what Sable keeps confidential, what remains publicly visible, and why the distinction matters.",
};

/**
 * The privacy page.
 *
 * Written to be *accurate before flattering*. An overstated privacy claim on a financial
 * product is not marketing, it is a safety problem: someone will make a decision based on
 * it. The metadata-leakage section is therefore as prominent as the protections.
 */
export default function PrivacyPage() {
  return (
    <ContentPage
      eyebrow="Privacy model"
      title="What Sable hides, and what it doesn't"
      intro="Sable protects your financial state. It does not make you anonymous. Those are different claims, and conflating them would be the most dangerous thing this page could do."
    >
      <ContentSection title="The short version">
        <Comparison
          left={{
            title: "Confidential",
            tone: "verified",
            items: [
              "Your savings balance",
              "Your yield mode — Steady or Lucky",
              "Deposit and withdrawal amounts",
              "Your time-weighted draw eligibility",
              "Your ticket range within a round",
              "Whether you won, and how much",
              "Your unclaimed rewards",
            ],
          }}
          right={{
            title: "Publicly visible",
            tone: "danger",
            items: [
              "That your address interacted with Sable",
              "When each of your transactions happened",
              "Which function you called — deposit, withdraw, set mode",
              "The gas you paid",
              "Aggregate round data: prize pool, tier amounts, participant count",
              "Whether a round's jackpot rolled forward",
            ],
          }}
        />
      </ContentSection>

      <ContentSection title="How the confidentiality works">
        <P>
          Sable is built on fully homomorphic encryption via the Zama Protocol. Values are encrypted
          in your browser and stay encrypted on-chain. The contracts compute over the ciphertext —
          adding yield, comparing a random draw point against your ticket range, selecting between
          branches — without ever decrypting anything.
        </P>
        <P>
          Access is enforced by an on-chain access control list. Sable grants your address
          permission to decrypt your own handles and nobody else&rsquo;s. When you reveal a balance,
          your wallet signs a time-bounded authorisation, and the key management service
          re-encrypts the result to a key held only by that browser session.
        </P>
        <Note tone="accent">
          This is FHE, not zero-knowledge proofs. The distinction matters: your data is not proven
          about and discarded, it is <em>computed on while still encrypted</em>. Sable uses ZK proofs
          for one narrow job — showing an encrypted input is well-formed — and nothing else.
        </Note>
      </ContentSection>

      <ContentSection title="Why the mode is the interesting part">
        <P>
          Encrypting balances is now reasonably well understood. Encrypting the <em>choice</em> is
          the harder problem, and it is where most confidential prize-savings designs leak.
        </P>
        <P>
          If opting into a draw meant calling a different function, the function selector would
          publish your choice to anyone reading the mempool — the balance would be encrypted and the
          decision beside it in plaintext. Sable avoids this structurally:
        </P>
        <List
          items={[
            "One function, one encrypted argument. Steady and Lucky produce identical calldata shapes.",
            "One event, carrying only an address. There is no LuckyModeEnabled event to subscribe to.",
            "Eligibility is computed with a homomorphic select over the encrypted bit, so both branches always execute and the gas cost is identical.",
            "A Steady saver receives an empty ticket range — arithmetically indistinguishable from any other allocation.",
            "Even never having set a mode is indistinguishable from having chosen Steady, because the default is stored encrypted too.",
          ]}
        />
      </ContentSection>

      <ContentSection title="Known metadata leakage">
        <P>
          Being precise about the limits is more useful than a stronger-sounding claim. The
          following are visible to anyone watching the chain, and Sable does not attempt to hide
          them:
        </P>
        <List
          items={[
            <>
              <strong className="text-[var(--color-primary)]">Your address.</strong> Transactions
              are sent from your wallet, so participation itself is public. Sable protects what you
              hold, not that you hold something.
            </>,
            <>
              <strong className="text-[var(--color-primary)]">Timing.</strong> When you deposited,
              withdrew or changed mode is public. Frequent activity around round boundaries is a
              behavioural signal no amount of encryption removes.
            </>,
            <>
              <strong className="text-[var(--color-primary)]">The amount you shield.</strong>{" "}
              Converting a public token into the confidential one calls{" "}
              <code className="text-[var(--color-primary)]">wrap(to, amount)</code>, where the
              amount is cleartext — as is the approval before it. Shielding is not itself private.
              What it buys is everything afterwards: the resulting balance, every transfer of it,
              your deposit and your yield mode are all encrypted. The same applies in reverse when
              you unwrap.
            </>,
            <>
              <strong className="text-[var(--color-primary)]">Aggregates.</strong> The round&rsquo;s
              prize pool is published, which is the sum of what Lucky savers contributed. With very
              few participants, an aggregate necessarily says more about each of them.
            </>,
            <>
              <strong className="text-[var(--color-primary)]">The rollover bit.</strong> Whether a
              jackpot point matched any ticket is published. That is one bit about total allocation
              across all savers, and nothing about any individual.
            </>,
            <>
              <strong className="text-[var(--color-primary)]">Participant count.</strong> How many
              accounts were scored in a round is public; which accounts, and with what weight, is
              not.
            </>,
          ]}
        />
        <Note>
          If your threat model requires that nobody learns you use a savings protocol at all, Sable
          is not sufficient on its own. It is designed to keep your financial position private, not
          to conceal your participation.
        </Note>
      </ContentSection>

      <ContentSection title="What Sable's operators can do">
        <P>
          Administrators can configure and advance rounds, and pause deposits in an emergency. That
          is the whole list.
        </P>
        <P>
          They cannot decrypt any balance, read any mode, see any weight, choose a winner, re-run a
          completed round, or move user funds. This is not a policy commitment — there is no
          function that does any of it, and the access control list never grants an administrator
          permission over another account&rsquo;s ciphertext. Withdrawals are deliberately not
          gated on the pause switch.
        </P>
      </ContentSection>

      <ContentSection title="What the app itself stores">
        <P>
          Nothing sensitive. Plaintext amounts exist only in browser memory between the moment you
          type them and the moment they are encrypted. They are never logged, never sent to a
          server, never placed in a URL or query parameter, and never written to local storage.
        </P>
        <P>
          Revealed balances are held in memory only and re-mask automatically after ninety seconds.
          The decryption authorisation is discarded when you disconnect or switch accounts. Private
          statements are generated entirely in your browser — no decrypted figure is transmitted to
          produce one.
        </P>
        <P>
          There is no analytics on this application, and no error-reporting service receiving
          values.
        </P>
      </ContentSection>

      <ContentSection title="Risk, stated plainly">
        <P>
          Sable runs on a test network with a test asset that has no value. As with any smart
          contract, the code carries risk: bugs are possible, and this protocol has not been
          externally audited.
        </P>
        <P>
          What the design does guarantee is narrower and worth stating exactly: no rule in this
          protocol routes one saver&rsquo;s principal into another saver&rsquo;s prize. Prizes are
          funded from yield alone. That is a property of the code, not a promise about DeFi in
          general — and it is not a claim that saving here is risk-free.
        </P>
        <P>
          The <InlineLink href="/security">security page</InlineLink> covers the architecture and
          trust assumptions in more detail.
        </P>
      </ContentSection>
    </ContentPage>
  );
}
