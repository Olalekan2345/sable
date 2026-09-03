# FHE security review

A dedicated review of the failure modes specific to computing on encrypted data. These are
mostly *not* the failure modes of ordinary Solidity, and several of them fail silently —
which is what makes them worth their own document.

Terminology note: Sable uses **fully homomorphic encryption**, not zero-knowledge proofs.
ZK proofs appear in exactly one place — attesting that an encrypted input is well-formed —
and nowhere else. The phrase "zero-knowledge privacy" is not used anywhere in this project,
because it would describe a different mechanism.

---

## 1. Ciphertext permissions

### The rule that governs everything

**Permissions attach to handles, not to storage slots.** Every homomorphic operation
produces a *new* handle. A permission granted to the old handle says nothing about the new
one.

The consequence is a failure mode with no immediate symptom: forget to re-grant after a
mutation and the transaction still succeeds. The account's *next* interaction reverts, or
their balance becomes permanently undecryptable. Nothing in the failing transaction points
at the transaction that caused it.

Sable routes every persistent write through one helper so this cannot be forgotten
piecemeal:

```solidity
function _persist(euint64 value, address account) internal {
    FHE.allowThis(value);        // contract can compute on it in later transactions
    FHE.allow(value, account);   // owner — and only the owner — can decrypt it
}
```

`allowThis` is not optional. Without it, the *next round's* arithmetic on that handle
reverts, long after the mistake.

### Permission inventory

| Handle | `allowThis` | `allow(owner)` | Public |
| --- | --- | --- | --- |
| `balance` | yes | yes | no |
| `reward` | yes | yes | no |
| `isLucky` | yes | yes | no |
| `roundWeight` | yes | yes | no |
| `ticketStart` / `ticketEnd` | yes | yes | no |
| `_totalDeposits` | yes | **no** | no |
| `_carryPool` | yes | no | no |
| `prizePool`, tier prizes | yes | no | **yes**, at finalization |
| `rollover`, `jackpotHit` | yes | no | **yes**, at completion |

`_totalDeposits` is deliberately readable by nobody. It is an aggregate the contract needs
for sizing the yield draw; no account has a legitimate claim to decrypt it, so none is
granted.

### Transient permissions

`FHE.allowTransient` scopes a grant to the current transaction. It is used at exactly two
boundaries, both times to let another contract compute on a handle Sable owns:

```solidity
FHE.allowTransient(toTake, address(asset));       // asset moves the deposit
FHE.allowTransient(owed, address(yieldAdapter));  // adapter delivers the yield
```

Permanent grants here would leave the token and the adapter able to read those handles
forever. Neither needs that, so neither gets it.

---

## 2. Overflow — the quiet one

**Encrypted arithmetic has no overflow checks.** An `euint64` that exceeds its range wraps
silently. There is no revert, no event, and no on-chain symptom. A corrupted balance simply
exists, and would be discovered by a saver at withdrawal time.

Sable therefore treats overflow as a design constraint rather than a runtime concern. The
budget:

```
euint64 max                            ≈ 1.8 × 10^19
MAX_CONFIDENTIAL_BALANCE                 1 × 10^12   (1,000,000 cUSDC at 6 decimals)

Weight:  balance × elapsed_minutes
         1e12 × 43,200 (30-day cap)    = 4.3 × 10^16     0.24% of range

Yield:   balance × index_delta
         1e12 × 4e6 (5× index ceiling) = 4.0 × 10^18      22% of range

Pool:    Σ lucky yield
         ≤ total deposits × 4          ≈ 2.6 × 10^14     negligible

Tiers:   pool × 10,000 (bps numerator)
         2.6e14 × 1e4                  = 2.6 × 10^18      14% of range
```

Each bound is **enforced**, not assumed:

| Bound | Enforcement |
| --- | --- |
| Balance ceiling | Homomorphic clamp at deposit — `min(requested, headroom)` before any transfer |
| Round duration | `RoundTooLong` reverts at configuration |
| Yield index ceiling | `YieldIndexCeilingExceeded` reverts, and the adapter clamps its own index |
| Ticket allocation | Per-participant cap `2^k / maxParticipants` |

### Why the balance ceiling is applied before the transfer

A branch cannot be taken conditionally on encrypted data, so "transfer, then reject if too
large" is not available — the tokens would already have moved. The cap is applied by clamping
the *request* against remaining headroom first:

```solidity
euint64 headroom = FHE.sub(MAX_CONFIDENTIAL_BALANCE, position.balance);
euint64 toTake   = FHE.min(requested, headroom);
```

`FHE.sub` is safe here because the invariant `balance ≤ MAX_CONFIDENTIAL_BALANCE` is
maintained by this very clamp — the subtraction can never underflow.

---

## 3. Confidentiality audit

Each surface below was reviewed specifically for leakage.

### Events

Every event was checked against the question: *could an observer reconstruct a private value
from this?*

| Event | Carries | Verdict |
| --- | --- | --- |
| `PrivateDeposit(address)` | address only | No amount exists on the event |
| `PrivateWithdrawal(address)` | address only | — |
| `PrivateModeUpdated(address)` | address only | Identical for Steady and Lucky |
| `PrivateRewardsClaimed(address)` | address only | — |
| `ParticipantRegistered(address, uint32)` | address, index | Registry position is public by nature |
| `RoundAggregatesPublished(...)` | ciphertext handles | Handles are public identifiers, not values |
| `SettlementAdvanced(roundId, cursor, total)` | cursors | No participant reference |

Deliberately absent: `Deposited(user, amount)`, `LuckyModeEnabled(user)`,
`SteadyModeEnabled(user)`, `WinnerSelected(user, prize)`. None of these exists anywhere in
the protocol.

### Function selectors

A single `setMode(externalEbool, bytes)` handles both modes. Separate `enableLucky()` and
`enableSteady()` functions would publish the choice through the selector alone — the balance
encrypted and the decision beside it in plaintext. This is the leak most confidential
prize-savings designs miss.

### Calldata

Both modes produce identical calldata length and shape. Verified by a test that submits both
and compares the transaction data.

### Gas and execution traces

`FHE.select` evaluates both branches unconditionally. A Lucky saver and a Steady saver
executing `setMode` consume the same operations. Settlement writes to *every* participant —
losers receive an encrypted zero rather than being skipped — so storage access patterns do
not distinguish a winner from a loser.

### Revert data

Reverts are public. No custom error in `SableErrors.sol` carries an amount, a mode or a
weight. Errors carry round ids, cursors, states and addresses — all already public.

Withdrawals clamp rather than revert on insufficient balance, precisely because a revert
would confirm to an observer that the caller holds less than the requested amount.

### Client storage and transport

- No plaintext amount is written to `localStorage`, `sessionStorage`, a cookie, a URL or a
  query parameter.
- Decrypted values live in React state only, and re-mask automatically after 90 seconds.
- The decryption authorisation is held in memory and discarded on disconnect or account
  change.
- No analytics and no error-reporting service are installed.
- Statements are generated in-browser; no decrypted figure is transmitted to produce one.

### Indexer

The database schema has **no columns** for balance, mode, weight, ticket range or reward.
This is stated as a structural property rather than a policy: there is nowhere to put such a
value. `account_events` records only that an address acted and when — exactly what the
on-chain event already contains.

---

## 4. Encrypted randomness

`FHE.randEuint64(bound)` requires a power-of-two bound and mutates coprocessor state, so it
only works inside a transaction.

- Winner selection never uses `block.timestamp`, `blockhash`, `prevrandao`, a client-side
  RNG or a server-side RNG.
- The operator who submits `drawBatch` cannot read the numbers it produced — they are
  ciphertexts, and the operator holds no permission over them.
- Draw points are generated in their own transaction, after ticket ranges are already fixed,
  so no participant can react to a drawn value.

### The rollover disclosure

`completeRound` publishes one bit: did every jackpot point land on an allocated ticket? Plus
the rollover amount, which for a single jackpot winner is a function of that same bit.

This is an intentional disclosure with a bounded cost. It reveals one bit about *aggregate*
ticket allocation across all participants, and nothing about any individual — notably not who
won when the jackpot was claimed. It is what allows the ledger to state honestly that a
jackpot rolled forward, rather than leaving a visitor to guess.

---

## 5. Denial of service through homomorphic cost

The protocol enforces 20,000,000 compute units and 5,000,000 sequential depth per
transaction. Exceeding either reverts with `HCUTransactionLimitExceeded`.

Measured cost of settling one participant against the 14-point ladder: **7,560,448 units**.
Two accounts fit in a transaction; three do not.

An unbounded loop over participants would therefore have been unschedulable long before it
was merely expensive. Every phase advances an explicit cursor and is resumable. An oversized
batch reverts *without advancing the cursor*, so the round is retried at a smaller size with
no state corruption — verified by a test.

Participants are appended to a registry that is never reordered, so indices stay stable and
a batch cannot skip or double-process an account.

---

## 6. What Sable protects, and what it does not

### Protected

Encrypted amounts, balances, the yield mode, time-weighted eligibility, ticket ranges,
individual prize results, and unclaimed rewards. All enforced by the on-chain ACL, not by
application logic.

### Not protected

- **Wallet address.** Transactions originate from the saver's wallet. Participation is
  public; the position is not.
- **Timing.** When each action occurred is public.
- **Interaction type.** The function called is visible — deposit, withdraw, set mode — even
  though its arguments are not.
- **Aggregates.** The round prize pool is published. With very few participants an aggregate
  necessarily says more about each of them.
- **Participant count.** How many accounts were scored is public; which ones, and with what
  weight, is not.

Sable protects financial state. It does not provide anonymity, and the privacy page says so
in those words. Overstating this on a financial product is a safety problem, not a marketing
choice.

---

## 7. Residual risks

- **No external audit.** This code has not been reviewed by a third party.
- **Trust in Zama's infrastructure.** Sable inherits the coprocessor's and KMS's correctness
  and confidentiality assumptions wholesale.
- **Relayer availability.** The relayer cannot see plaintext, but if it is down, encryption
  and decryption are unavailable. Funds are unaffected — withdrawals still require only a
  transaction.
- **Small anonymity sets.** With a handful of participants, aggregate figures and timing
  correlate more strongly with individuals than the encryption alone suggests.
- **Testnet yield.** Yield is issued by an adapter at a published rate, not sourced from an
  external venue. This is stated in the UI, the README and `/how-it-works`.
