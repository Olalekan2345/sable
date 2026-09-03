import type { Metadata } from "next";

import { HCU_BUDGET, PROTOCOL_LIMITS } from "@sable/config";

import { CodeBlock, ContentPage, ContentSection, List, Note, P } from "@/components/content/prose";
import { InlineLink } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Sable's technical documentation: architecture, FHE data model, draw algorithm, and measured performance.",
};

export default function DocsPage() {
  return (
    <ContentPage
      eyebrow="Documentation"
      title="Technical reference"
      intro="The design decisions behind Sable, including the ones where the obvious approach turned out to be wrong."
    >
      <ContentSection id="architecture" title="Architecture">
        <CodeBlock caption="Three source layers, one deployed contract, plus two genuinely separate contracts.">
{`SableAccessControl ─┐
                    ├─ SableCore ─ SableVault ─ SablePrizeEngine ─ Sable
ZamaEthereumConfig ─┘

SableReserveYieldAdapter  Reserve-backed yield (external asset)
SableTestnetYieldAdapter  Mint-backed yield (self-issued asset)`}
        </CodeBlock>
        <P>
          <strong className="text-[var(--color-primary)]">SableCore</strong> holds storage,
          configuration and the confidential primitives: checkpointing, yield accrual and the ACL
          helper every ciphertext write passes through.{" "}
          <strong className="text-[var(--color-primary)]">SableVault</strong> adds deposits,
          withdrawals, the confidential mode and reward claiming.{" "}
          <strong className="text-[var(--color-primary)]">SablePrizeEngine</strong> adds the round
          lifecycle, ticket allocation, the encrypted draw and settlement.
        </P>
      </ContentSection>

      <ContentSection id="fhe" title="The FHE data model">
        <P>
          Everything monetary is <span className="font-mono text-[13px]">euint64</span>, matching
          ERC-7984 so no cast is ever needed at the token boundary. The mode is an{" "}
          <span className="font-mono text-[13px]">ebool</span>.
        </P>
        <CodeBlock>
{`struct Position {
    euint64 balance;   // principal + compounded Steady yield
    euint64 reward;    // prize winnings, not yet claimed
    ebool   isLucky;   // the confidential mode bit
}

roundId => account => euint64  roundWeight    // mode-gated eligibility
roundId => account => euint64  ticketStart    // half-open range [start, end)
roundId => account => euint64  ticketEnd`}
        </CodeBlock>
        <P>
          Round-scoped state lives in separate mappings rather than inside the position, so a new
          round starts clean without an O(participants) reset, and a completed round&rsquo;s
          allocation stays independently auditable.
        </P>
      </ContentSection>

      <ContentSection title="Why yield uses a public index">
        <P>
          FHEVM has no encrypted-by-encrypted division. That single constraint shaped the entire
          yield model: Sable cannot compute one saver&rsquo;s share of a pooled return
          homomorphically, because the divisor would itself be a ciphertext.
        </P>
        <P>
          So the yield <em>rate</em> is public and each encrypted balance is multiplied by a public
          index delta. That is exact, costs one scalar multiply, and leaks a protocol parameter
          rather than a position.
        </P>
        <CodeBlock caption="Both branches always execute, so the routing reveals nothing.">
{`yield  = balance × (index − userIndex) / INDEX_SCALE
steady = select(isLucky, 0, yield)      // compounds into balance
lucky  = select(isLucky, yield, 0)      // funds the prize pool`}
        </CodeBlock>
        <Note tone="accent">
          This is also what makes principal safety structural. The prize pool can only ever be fed
          from the <span className="font-mono text-[13px]">lucky</span> branch, whose value is
          bounded by that interval&rsquo;s interest. No expression anywhere moves principal into a
          reward.
        </Note>
      </ContentSection>

      <ContentSection title="The draw algorithm">
        <P>
          <span className="font-mono text-[13px]">FHE.randEuint64(bound)</span> requires{" "}
          <span className="font-mono text-[13px]">bound</span> to be a power of two. That is a
          property of the library, and it propagates directly into the product design.
        </P>
        <CodeBlock caption="Allocation is bounded by construction, so ranges can never overlap or exceed the domain.">
{`tickets      = min(weight / weightPerTicket, 2^k / maxParticipants)
[start, end) = [cumulative, cumulative + tickets)

isWinner = (point >= start) AND (point < end)
reward  += select(isWinner, tierPrize, 0)`}
        </CodeBlock>
        <P>
          Every participant is evaluated against every draw point and every participant receives a
          result — losers an encrypted zero rather than being skipped. That symmetry is the privacy
          property: there is no winners list, no event naming an address, and no branch whose cost
          differs between winning and losing.
        </P>
        <P>
          Whatever part of the ticket space is unallocated stays dark, and a jackpot point landing
          there matches nobody. The rollover is not an error path bolted on afterwards — it is the
          unavoidable consequence of a fixed random domain, surfaced as a product feature.
        </P>
      </ContentSection>

      <ContentSection title="Both decryption paths">
        <P>
          Sable uses the two Zama decryption flows for two genuinely different jobs:
        </P>
        <List
          items={[
            <>
              <strong className="text-[var(--color-primary)]">Public decryption.</strong> The
              contract marks a round&rsquo;s aggregate prize figures publicly decryptable at
              finalization. Any client resolves them through the relayer with no wallet. This is what
              lets the draw ledger show real numbers to an anonymous visitor.
            </>,
            <>
              <strong className="text-[var(--color-primary)]">User decryption.</strong> Balances,
              modes, weights and rewards are readable only by the owning account, via an EIP-712
              authorisation and a session keypair.
            </>,
          ]}
        />
        <P>
          Individual positions never take the public path. The aggregate is an aggregate over all
          Lucky savers, so publishing it exposes no individual — while keeping it secret would force
          the ledger to show redacted boxes where a real prize belongs.
        </P>
      </ContentSection>

      <ContentSection title="Measured performance">
        <P>
          Batch sizes are derived from measurement, not assumption. These figures come from the
          repository&rsquo;s HCU benchmark against the protocol&rsquo;s{" "}
          {HCU_BUDGET.maxGlobalPerTx.toLocaleString("en-US")} unit per-transaction ceiling:
        </P>
        <div className="surface-inset overflow-x-auto p-6">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-hairline)]">
                <th className="pb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-tertiary)]">
                  Operation
                </th>
                <th className="pb-3 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-tertiary)]">
                  HCU
                </th>
              </tr>
            </thead>
            <tbody className="text-[var(--color-secondary)]">
              {[
                ["Set mode", HCU_BUDGET.measured.setMode],
                ["Deposit", HCU_BUDGET.measured.deposit],
                ["Withdraw", HCU_BUDGET.measured.withdraw],
                ["Eligibility, per account", HCU_BUDGET.measured.eligibilityPerAccount],
                ["Ticket assignment, per account", HCU_BUDGET.measured.ticketsPerAccount],
                ["Settlement, per account", HCU_BUDGET.measured.settlementPerAccount],
                ["Finalize round", HCU_BUDGET.measured.finalizeRound],
                ["Complete round", HCU_BUDGET.measured.completeRound],
              ].map(([label, value]) => (
                <tr key={label as string} className="border-b border-[var(--color-hairline)] last:border-0">
                  <td className="py-2.5">{label}</td>
                  <td className="text-numeric py-2.5 text-right font-mono">
                    {(value as number).toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <P>
          Settlement dominates, which is why it is limited to{" "}
          {HCU_BUDGET.batchDefaults.settle} accounts per transaction. A fifty-participant round is
          entirely feasible — it simply takes about twenty-five settlement transactions rather than
          one. That is an operational cost, not a wall, which is precisely why every phase is
          resumable.
        </P>
      </ContentSection>

      <ContentSection title="Protocol limits">
        <div className="surface-inset p-6">
          <dl className="flex flex-col gap-3 text-[13px]">
            {[
              ["Maximum balance per account", `${(PROTOCOL_LIMITS.maxBalance / 1_000_000n).toLocaleString("en-US")} cUSDC`],
              ["Weight granularity", `${PROTOCOL_LIMITS.weightTimeUnitSeconds} seconds`],
              ["Maximum round duration", `${PROTOCOL_LIMITS.maxRoundDurationSeconds / 86400} days`],
              ["Yield index scale", PROTOCOL_LIMITS.indexScale.toLocaleString("en-US")],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-6">
                <dt className="text-[var(--color-tertiary)]">{label}</dt>
                <dd className="font-mono text-[var(--color-secondary)]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <P>
          These are not arbitrary. Each one bounds a product that would otherwise risk silently
          wrapping an <span className="font-mono text-[13px]">euint64</span> — see the{" "}
          <InlineLink href="/security">security page</InlineLink> on why encrypted arithmetic needs
          this care.
        </P>
      </ContentSection>

      <ContentSection title="Repository documentation">
        <P>
          Deeper material lives alongside the code, including the verified Zama API notes recording
          which version choices were checked against installed packages rather than assumed:
        </P>
        <CodeBlock>
{`docs/ZAMA_IMPLEMENTATION_NOTES.md   verified version matrix and API surface
docs/ARCHITECTURE.md                contract design and data flow
docs/FHE_SECURITY.md                ciphertext permissions, leakage audit
docs/PRIZE_ENGINE.md                weighting, tickets, draw, rollover
docs/PRIVACY_MODEL.md               what is protected, what is not
docs/TESTING.md                     test architecture and coverage
docs/DEPLOYMENT.md                  Sepolia deployment and operations`}
        </CodeBlock>
      </ContentSection>
    </ContentPage>
  );
}
