# Privacy model

What Sable protects, what it does not, and where exactly the line falls.

The organising principle of this document is that **an overstated privacy claim on a
financial product is a safety problem, not a marketing choice**. Someone will make a decision
based on it. So the limitations below are stated as prominently as the protections.

---

## 1. Summary

| | |
| --- | --- |
| **Protected** | Savings balance, yield mode, deposit and withdrawal amounts, time-weighted eligibility, ticket range, prize results, unclaimed rewards |
| **Public** | Your address, transaction timing, which function you called, gas paid, aggregate round data, participant count, whether a jackpot rolled forward |

Sable protects **financial state**. It does not provide **anonymity**. Those are different
claims and conflating them would be the most dangerous thing this document could do.

---

## 2. The mechanism

Sable uses fully homomorphic encryption via the Zama Protocol. Values are encrypted in the
browser and stay encrypted on-chain. Contracts compute over the ciphertext — adding yield,
comparing a random point against a ticket range, selecting between branches — without
decrypting anything.

Access is enforced by an on-chain access control list, not by application logic. Sable grants
your address permission to decrypt your own handles and nobody else's.

### A note on terminology

This is FHE, **not** zero-knowledge proofs. The distinction matters: your data is not proven
about and discarded, it is *computed on while still encrypted*. Sable uses ZK proofs for
exactly one job — attesting that an encrypted input is well-formed — and nothing else. The
phrase "zero-knowledge privacy" does not appear anywhere in this project because it would
describe a different mechanism.

---

## 3. Confidential mode — the part that is genuinely novel

Encrypting balances is well-trodden. Encrypting the *choice* is harder, and it is where most
confidential prize-savings designs leak.

If opting into a draw meant calling a different function, the function selector would publish
the decision to anyone reading the mempool. The balance would be encrypted and the choice
would be sitting next to it in plaintext.

Sable prevents this structurally:

| Vector | How it is closed |
| --- | --- |
| Function selector | One `setMode(externalEbool, bytes)` for both modes |
| Calldata shape | Identical length and structure; asserted by test |
| Event logs | `PrivateModeUpdated(address)` — no mode field exists |
| Execution trace | `FHE.select` evaluates both branches unconditionally |
| Gas cost | Identical for both modes |
| Ticket allocation | A Steady saver gets an empty range — arithmetically ordinary |
| Never having chosen | The default is Lucky, stored encrypted, so it is indistinguishable from an explicit Lucky |

That last row matters more than it looks. If the default were an uninitialised handle, "has
never set a mode" would itself be a public signal.

---

## 4. Known metadata leakage

Being precise about limits is more useful than a stronger-sounding claim.

### Your address is public

Transactions originate from your wallet. **Participation in Sable is public.** Anyone can see
that an address deposited, and when.

Sable protects what you hold, not that you hold something. If your threat model requires that
nobody learns you use a savings protocol at all, this is not sufficient on its own.

### Timing is public

When each action occurred is visible. Repeated activity around round boundaries is a
behavioural signal that no amount of encryption removes.

### The amount you shield or unwrap is public

Value enters the confidential side through Zama's wrapper, and `wrap(to, amount)` takes a
**cleartext** amount — as does the ERC-20 `approve` that precedes it. Unwrapping is public in
the same way, and necessarily so: the released amount has to be publicly decrypted before it
can appear as an ordinary ERC-20 transfer.

So the boundary crossings are visible. What confidentiality covers is everything between them:
the balance you hold, every confidential transfer, your deposit, your yield mode, your draw
weight and your rewards.

This matters practically. An observer who sees an address shield exactly 250 USDCMock and then
deposit learns an upper bound on that deposit. The bound decays as soon as yield accrues or
further deposits and withdrawals occur, but on a fresh account with a single wrap it is tight.
**Shielding a round number and immediately depositing all of it is the weakest pattern**; the
app says so at the point of the action rather than only here.

### Interaction type is public

The function called is visible — deposit, withdraw, set mode, claim — even though its
arguments are not. An observer knows you changed your mode; they cannot know to what.

### Aggregates are published

The round prize pool and per-tier amounts are made publicly decryptable at finalization.

This is a deliberate trade. The pool is an aggregate over all Lucky savers, so it exposes no
individual position — and keeping it secret would force the public ledger to show redacted
boxes where a real prize belongs.

**The caveat is anonymity-set size.** With two participants, an aggregate says a great deal
about each. Sable does not currently enforce a minimum participant count before publishing.
On a testnet with few users, treat the aggregate as weakly revealing.

### The numbers drawn are published

Once a round completes, its draw points become publicly decryptable. Until then they are
ciphertexts nobody can read — including the operator who generated them, which is what stops a
draw being steered.

Publishing them is what makes the draw *checkable* rather than merely trustworthy: anyone can
confirm the points fall inside the ticket domain and that there are as many as the round was
configured for. Ticket ranges stay encrypted, so this reveals where the draw landed and never
whose holding it landed in.

**What it leaks.** Combined with the rollover bit — which says whether every jackpot point fell
inside the allocated span — the published points bracket the *total* allocated ticket span, and
so the aggregate weight of all Lucky savers. That is an aggregate in the same category as the
prize pool, with the same caveat: with very few participants an aggregate says more about each
of them.

The points are released at completion rather than at draw time. Published earlier, a saver who
can decrypt their own ticket range could determine their result before the protocol had
finished settling it.

### The rollover bit is published

Whether every jackpot point matched an allocated ticket is published as a single bit. That is
one bit about *aggregate* allocation across all savers, and nothing about any individual —
notably not who won when the jackpot was claimed.

### Participant count is public

How many accounts were scored in a round is public; which accounts, and with what weight, is
not.

### Your RPC provider sees your reads

Everything above concerns the chain. This one concerns the network path to it.

The browser reads Sable's state through whatever endpoint `NEXT_PUBLIC_RPC_URL` names. That
provider sees your IP address alongside the contracts you query and the account you query them
for — which is a link between a network identity and an on-chain one that the ledger itself
never publishes. It does **not** see plaintext: decryption happens in your browser, and the
ciphertext that crosses the wire is useless without your EIP-712 signature.

If the variable is unset the app falls back to a public endpoint, and the wallet kit adds
Reown's RPC behind it as a second fallback, so an outage does not blank the interface. That
fallback means reads can reach Reown when the primary endpoint fails. **Set your own RPC
endpoint** if this matters to you; a self-hosted node removes the third party altogether.

### The wallet chooser contacts Reown

When a WalletConnect project id is configured, opening the connect dialog fetches the wallet
list and configuration from `api.web3modal.org`. That reveals a visitor is opening a wallet
dialog, from an IP, against a known project id. Leaving the id unset avoids this entirely —
Sable's built-in picker discovers installed wallets over EIP-6963 with no network call.

No analytics or telemetry is shipped from the app. That is asserted by a test rather than
promised: `e2e/smoke.spec.ts` fails the build if any request reaches a known analytics host
before a wallet is connected. It exists because an earlier dependency did exactly that.

---

## 5. What Sable's operators can do

| Can | Cannot |
| --- | --- |
| Configure a round's timing and tiers | Decrypt any balance |
| Open, close and advance rounds | Read any account's mode |
| Replace the yield adapter | See any draw weight or ticket range |
| Pause deposits and mode changes | Choose or influence a winner |
| | Re-run or alter a completed round |
| | Move, freeze or seize user funds |
| | Block withdrawals |

The right-hand column is enforced by absence: no such function exists, and the ACL never
grants an administrator permission over another account's ciphertext. It is a property of the
code, not a policy commitment.

Withdrawals are deliberately not gated on the pause switch.

---

## 6. What the application stores

Nothing sensitive.

- Plaintext amounts exist only in browser memory, between being typed and being encrypted.
- Never logged, never sent to a server, never in a URL or query parameter, never in
  `localStorage`, `sessionStorage` or a cookie.
- Revealed balances are held in React state and re-mask automatically after 90 seconds.
- The decryption authorisation is memory-only and discarded on disconnect or account change.
- Statements are generated entirely in-browser; no decrypted figure is transmitted to
  produce one.
- No analytics. No error-reporting service.

### The indexer

The indexer archives **public round metadata only**. Its schema has no columns for balance,
mode, weight, ticket range or reward — this is structural, not a policy: there is nowhere to
put such a value. A compromise of that database yields no financial data.

Recreating a plaintext surveillance database beside an encrypted protocol would defeat the
entire point. The ciphertext would be immaculate and the answers would be in Postgres.

---

## 7. Threat model

| Adversary | Sees | Does not see |
| --- | --- | --- |
| Chain observer | Addresses, timing, function calls, aggregates | Any individual amount, mode, weight or result |
| Another saver | The same as any observer | Anything about your position |
| Sable operator | The same, plus the ability to advance rounds | Anything confidential; they hold no ACL grants |
| Indexer operator | Public logs and round state | Anything confidential; no keys, no columns |
| Relayer | That a decryption was requested | Plaintext values |
| Zama KMS | Trusted for correctness of authorised decryption | — trusted party; Sable inherits this |
| Someone with your device | Whatever is on screen | Anything requiring a wallet signature |

---

## 8. Residual risks

- **No external audit.**
- **Small anonymity sets** make aggregates and timing correlate more strongly with
  individuals than encryption alone suggests.
- **Zama infrastructure is trusted** for correctness and confidentiality of decryption.
- **Testnet yield** is issued by an adapter at a published rate, not sourced externally.
- **Wallet hygiene** is outside Sable's control. Using an address already linked to your
  identity links your Sable participation to it too.
