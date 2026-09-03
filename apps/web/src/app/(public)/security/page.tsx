import type { Metadata } from "next";

import { NETWORK_LABEL, ZAMA_CONTRACTS, ZAMA_RELAYER_URL, addresses, deployment } from "@sable/config";

import { CodeBlock, ContentPage, ContentSection, List, Note, P } from "@/components/content/prose";
import { ExplorerLink, InlineLink } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Security",
  description:
    "Sable's security architecture: contract design, access control, invariants, trust assumptions and known limitations.",
};

export default function SecurityPage() {
  return (
    <ContentPage
      eyebrow="Security"
      title="Architecture and trust assumptions"
      intro="What the protocol enforces, what it relies on, and what it does not protect against."
    >
      <ContentSection title="Deployment">
        {addresses.sable ? (
          <>
            <P>
              Sable is deployed on {NETWORK_LABEL}. Every contract is verifiable on the block
              explorer.
            </P>
            <div className="surface-inset flex flex-col gap-3 p-6">
              <Row label="Sable vault" address={addresses.sable} />
              {addresses.asset ? (
                <Row
                  label={`Confidential asset (${deployment?.asset.symbol ?? "cUSDC"})`}
                  address={addresses.asset}
                />
              ) : null}
              {addresses.underlying ? (
                <Row label="Underlying ERC-20" address={addresses.underlying} />
              ) : null}
              {addresses.yieldAdapter ? (
                <Row label="Yield adapter" address={addresses.yieldAdapter} />
              ) : null}
              {deployment ? (
                <p className="mt-1 text-[12px] text-[var(--color-tertiary)]">
                  Deployed {new Date(deployment.deployedAt).toUTCString()}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <Note>
            The contracts are not yet deployed in this environment, so no addresses are shown. Sable
            will not display placeholder addresses.
          </Note>
        )}
      </ContentSection>

      <ContentSection title="Zama Protocol contracts">
        <P>
          Sable does not implement encryption itself. It builds on the Zama Protocol&rsquo;s
          coprocessor, key management service and access control list, all deployed by Zama on{" "}
          {NETWORK_LABEL}.
        </P>
        <div className="surface-inset flex flex-col gap-4 p-6">
          {ZAMA_CONTRACTS.map((contract) => (
            <div key={contract.name}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-[13px] font-medium text-[var(--color-primary)]">
                  {contract.name}
                </span>
                <ExplorerLink address={contract.address} />
              </div>
              <p className="mt-1 text-[12px] text-[var(--color-tertiary)]">{contract.description}</p>
            </div>
          ))}
          <p className="mt-1 font-mono text-[11px] text-[var(--color-quaternary)]">
            Relayer: {ZAMA_RELAYER_URL}
          </p>
        </div>
      </ContentSection>

      <ContentSection title="Contract architecture">
        <P>
          The vault, round machine and prize engine are written as separate source files but compile
          into a single deployed contract. That is a deliberate departure from the usual
          one-concern-one-contract instinct, and the reason is specific to FHE.
        </P>
        <P>
          Ciphertexts do not cross contract boundaries for free. Every handle passed between
          contracts needs an explicit transient permission grant on the way out and a check on the
          way back, on every call. Splitting the prize engine from the vault would mean granting it
          transient access to every participant&rsquo;s balance and mode on every settlement batch —
          a strictly larger attack surface, more homomorphic work, and considerably more to audit,
          in exchange for a tidier diagram.
        </P>
        <P>
          The contracts that genuinely are separate are the ones with separate trust boundaries: the
          ERC-7984 confidential asset, and the yield adapter.
        </P>
      </ContentSection>

      <ContentSection title="Access control over ciphertext">
        <P>
          The critical detail in any FHEVM application is that permissions attach to{" "}
          <em>handles</em>, not to storage slots. Every homomorphic operation produces a new handle,
          so permissions must be re-granted after every mutation — a missed grant does not fail
          immediately, it fails on the account&rsquo;s <em>next</em> interaction.
        </P>
        <P>Sable routes every persistent ciphertext write through one helper:</P>
        <CodeBlock caption="Called after every mutation of a user-owned ciphertext, without exception.">
{`function _persist(euint64 value, address account) internal {
    FHE.allowThis(value);          // the contract can keep computing on it
    FHE.allow(value, account);     // only the owner can decrypt it
}`}
        </CodeBlock>
        <P>
          Administrators are never granted permission over another account&rsquo;s handle, which is
          what makes &ldquo;operators cannot read your balance&rdquo; a structural property rather
          than a policy.
        </P>
      </ContentSection>

      <ContentSection title="Enforced invariants">
        <P>Each of these is covered by tests in the repository:</P>
        <List
          items={[
            "A saver's principal can never become another saver's prize. The prize pool is fed exclusively from a select over the encrypted mode applied to accrued yield.",
            "Only yield attributed to Lucky participation reaches the prize pool.",
            "A plaintext mode is never revealed by contract state, calldata shape, event log or gas cost.",
            "A plaintext balance is never publicly revealed. Only aggregates are made publicly decryptable.",
            "Settlement never distributes more than the pool holds — enforced by validation at configuration time and floor division at every step.",
            "A completed round cannot execute again. Every state transition is guarded and invalid ones revert.",
            "A reward cannot be credited twice; claiming clears the handle atomically.",
            "Unauthorised accounts cannot decrypt another account's values through any application flow.",
          ]}
        />
      </ContentSection>

      <ContentSection title="Overflow, and why it needs care here">
        <P>
          Encrypted arithmetic does not behave like ordinary Solidity. There are no overflow checks
          on ciphertext: an <span className="font-mono text-[13px]">euint64</span> that exceeds its
          range wraps silently, with no revert and no on-chain symptom. A corrupted balance would
          simply exist.
        </P>
        <P>Sable prevents this structurally rather than hoping for it:</P>
        <List
          items={[
            "A per-account balance ceiling is enforced homomorphically at deposit, by clamping the request against remaining headroom before any tokens move.",
            "The yield index has a hard ceiling, so balance × index-delta cannot approach 2^63.",
            "Round duration is capped, bounding balance × elapsed-minutes in the weight calculation.",
            "Ticket allocation is capped per participant so the sum can never exceed the ticket domain.",
          ]}
        />
      </ContentSection>

      <ContentSection title="Batching and denial of service">
        <P>
          Homomorphic operations are metered. The protocol enforces a ceiling of 20,000,000 compute
          units per transaction and 5,000,000 of sequential depth — exceeding either reverts.
        </P>
        <P>
          Settling one participant against the full fourteen-point tier ladder measures at roughly
          7.56 million units, so at most two accounts fit in a single transaction. Every phase of a
          round is therefore cursor-based and resumable, sized from measurements rather than
          assumptions. An oversized batch reverts without advancing the cursor, so the round is
          simply retried at a smaller size.
        </P>
      </ContentSection>

      <ContentSection title="Trust assumptions">
        <List
          items={[
            "Zama's coprocessor and key management service perform decryption correctly and do not leak plaintexts. Sable inherits this assumption wholesale.",
            "The relayer is trusted for availability, not for confidentiality — it never sees plaintext values.",
            "Administrators can configure rounds and pause deposits. They cannot read, choose or seize anything.",
            "The contracts are not upgradeable. For a protocol custodying savings with a small immutable rule set, a proxy would add an admin capability more dangerous than the bugs it could fix.",
          ]}
        />
        <Note>
          Sable has not undergone an external security audit. It is a testnet protocol with a test
          asset that carries no value. Treat it as demonstration software.
        </Note>
      </ContentSection>

      <ContentSection title="Reporting an issue">
        <P>
          If you find a vulnerability, please report it privately rather than opening a public issue.
          The <InlineLink href="/docs">technical documentation</InlineLink> covers the FHE-specific
          security review in more detail, including the event and calldata confidentiality audit.
        </P>
      </ContentSection>
    </ContentPage>
  );
}

function Row({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <span className="text-[13px] text-[var(--color-secondary)]">{label}</span>
      <ExplorerLink address={address} />
    </div>
  );
}
