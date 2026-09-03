import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button";
import { CodeBlock, ContentPage, ContentSection, List, Note, P } from "@/components/content/prose";
import { InlineLink } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Sable is a confidential savings protocol. Deposit privately, choose privately how your yield works, and withdraw whenever you like.",
};

export default function HowItWorksPage() {
  return (
    <ContentPage
      eyebrow="How it works"
      title="A savings account that keeps its mouth shut"
      intro="Sable lets you save on a public blockchain without publishing what you saved, what you chose to do with the yield, or what you won. Here is the whole mechanism, in order."
    >
      <ContentSection title="1. You deposit, privately">
        <P>
          You deposit a confidential asset. Before the amount leaves your browser it is encrypted,
          and a zero-knowledge proof is attached showing the ciphertext is well-formed. What reaches
          the blockchain is an opaque handle and a proof — not a number.
        </P>
        <P>
          From then on your balance lives on-chain as ciphertext. Sable&rsquo;s contracts can add to
          it, subtract from it and compare it, but they cannot read it. Neither can we.
        </P>
        <Note>
          Because amounts are encrypted, a transfer that exceeds your wallet balance moves nothing
          rather than partially filling. Sable checks your balance in the browser first so you never
          spend gas on a deposit that would silently do nothing.
        </Note>
        <P>
          Sable accepts Zama&rsquo;s published confidential token and does not issue one of its own
          — it is a vault, not an issuer. If you already hold the public token underneath it, the
          app will wrap it for you in two transactions; otherwise you bring the confidential token
          to your wallet the same way you would any other asset.
        </P>
      </ContentSection>

      <ContentSection title="2. You choose what happens to the yield">
        <P>
          Your savings earn yield. You decide privately where it goes:
        </P>
        <List
          items={[
            <>
              <strong className="text-[var(--color-primary)]">Steady</strong> — the yield compounds
              into your own position. You are not entered into any draw.
            </>,
            <>
              <strong className="text-[var(--color-primary)]">Lucky</strong> — the yield goes to a
              shared prize pool, and your savings earn eligibility for that round&rsquo;s draw.
            </>,
          ]}
        />
        <P>
          Your principal is untouched either way. The only thing that changes is the destination of
          the interest it earns.
        </P>
        <P>
          The choice itself is encrypted. There is one function, taking one opaque ciphertext — no
          separate <span className="font-mono text-[13px]">enableLucky()</span> to give the game
          away, and no mode in any event log.
        </P>
      </ContentSection>

      <ContentSection title="3. Holding longer earns more eligibility">
        <P>
          Draw weight is your balance multiplied by the time you actually held it while in Lucky
          mode. Depositing a large sum moments before a draw earns almost nothing, because almost no
          time has passed.
        </P>
        <CodeBlock caption="Weight accrues per whole minute, gated by your encrypted mode.">
{`roundWeight += select(isLucky, balance × elapsedMinutes, 0)`}
        </CodeBlock>
        <P>
          Switching mode is not retroactive in either direction. Time spent in Steady is never
          converted into eligibility after the fact, and eligibility already earned in Lucky is never
          clawed back.
        </P>
      </ContentSection>

      <ContentSection title="4. The draw runs on encrypted numbers">
        <P>
          When a round closes, each participant is assigned a private range inside a fixed ticket
          space. The protocol then draws random points on-chain — encrypted random numbers that
          nobody, including the operator who submitted the transaction, can read.
        </P>
        <P>
          Each participant is compared against each point entirely over ciphertext. Everybody
          receives an encrypted result: winners a prize amount, everyone else an encrypted zero.
          There is no winners list, and no event names an address.
        </P>
        <Note tone="accent">
          You find out whether you won by decrypting your own result. Nobody else can — not other
          savers, not observers, not Sable.
        </Note>
      </ContentSection>

      <ContentSection title="5. Sometimes nobody wins, and that is by design">
        <P>
          The ticket space is a fixed power of two, because the encrypted random number generator
          requires a power-of-two bound. Participants occupy part of it; the rest stays unassigned.
        </P>
        <P>
          When a jackpot point lands in unassigned space it matches nobody, and the jackpot rolls
          into the next round instead. That is not a failure — it is what keeps the ticket
          boundaries secret, and it makes the next jackpot larger.
        </P>
      </ContentSection>

      <ContentSection title="6. You withdraw whenever you like">
        <P>
          There is no lock-up and no round-based exit restriction. Withdrawals remain available even
          if the protocol is paused, because a pause that trapped savings would make the central
          promise conditional on how operators behave.
        </P>
      </ContentSection>

      <ContentSection title="Where the yield actually comes from">
        <P>
          This matters, and vague answers here are how people get hurt.
        </P>
        <P>
          Sable custodies <strong className="text-[var(--color-primary)]">cUSDC (Mock)</strong>,
          Zama&rsquo;s published confidential test token — not a token Sable issues. That distinction
          is deliberate: a savings protocol that mints the very asset it holds invites an obvious
          question about where the money comes from.
        </P>
        <P>
          Because Sable cannot mint an asset it does not own, yield is paid from a{" "}
          <strong className="text-[var(--color-primary)]">funded reserve</strong> — real tokens
          somebody put in, at a rate published on-chain, accruing against real elapsed time. The
          adapter caps its own accrual at what the reserve provably covers, so it can never credit
          yield it is unable to pay. An unfunded deployment simply earns nothing.
        </P>
        <P>
          It is real on-chain accrual, all verifiable — but it is <em>not</em> external yield.
          Nobody is borrowing these savings and paying interest on them. A production deployment
          would swap the adapter for a genuine venue without changing anything else in the protocol.
        </P>
        <Note>
          The test asset is not pegged to anything, carries no issuer, and is not redeemable. Its
          numbers behave like money so the product can be exercised end to end; they are not money.
        </Note>
      </ContentSection>

      <ContentSection title="What is public, and what is not">
        <P>
          Round mechanics are public: when a round opened and closed, how it was configured, the
          prize pool, the tier amounts, and every transaction that executed it. You can check all of
          it on the <InlineLink href="/draws">public draw ledger</InlineLink> without connecting
          anything.
        </P>
        <P>
          Individual positions are not: balances, modes, draw weights, ticket ranges and results are
          encrypted, and only the account they belong to can read them.
        </P>
        <P>
          One thing Sable does <em>not</em> hide is that your address interacted with it, and when.
          That is a property of a public blockchain, and the{" "}
          <InlineLink href="/privacy">privacy model</InlineLink> sets out exactly where the line
          falls.
        </P>
      </ContentSection>

      <div className="flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/app" size="lg">
          Start saving
        </ButtonLink>
        <ButtonLink href="/privacy" size="lg" variant="outline">
          Read the privacy model
        </ButtonLink>
      </div>
    </ContentPage>
  );
}
