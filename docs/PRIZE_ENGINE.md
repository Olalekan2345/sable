# Prize engine

Time weighting, ticket allocation, the draw, and the rollover. This is the part of Sable
where the cryptography's constraints are most visible in the product, so each section states
the constraint before the design it forced.

---

## 1. Time-weighted eligibility

### The problem

Without time weighting, a saver could deposit a large sum one block before a draw and hold
the same eligibility as capital that sat in the pool all round. That is not a savings
product; it is a lottery with extra steps.

### The mechanism

Weight accrues continuously as balance × time, gated by the encrypted mode:

```solidity
euint64 delta = FHE.mul(position.balance, elapsedUnits);
euint64 gated = FHE.select(position.isLucky, delta, zero);
roundWeight   = FHE.add(roundWeight, gated);
```

`elapsedUnits` is whole minutes (`WEIGHT_TIME_UNIT = 60`). Minutes rather than seconds keeps
the multiplier small enough that a maximal balance held for a maximal round stays at 0.24%
of the `euint64` range.

### Why the checkpoint ordering matters

`_checkpoint` runs **before** any mutation of balance or mode. Weight is an integral over the
interval that just ended, so it must be computed against the values in force *during* that
interval. Checkpointing afterwards would retroactively re-price history — reintroducing
exactly the sniping vector this exists to close.

Because `setMode` checkpoints before flipping the bit, mode switching is non-retroactive in
both directions:

| Scenario | Result |
| --- | --- |
| Steady for half a round, then Lucky | Weight for the second half only |
| Lucky for half a round, then Steady | Weight for the first half only, retained |
| Never touched a round | Full round of weight, no action required |
| Deposited 10 seconds before close | Zero — under a minute floors to zero units |

All four are covered by tests asserting exact values, not inequalities.

### Idempotence at the close

A saver may transact between `closeRound` and their eligibility batch. Their checkpoint
accrues up to `closedAt`; the batch then accrues zero more, because the window arithmetic
clamps to the close time. No per-account "already processed" flag is needed — the operation
is naturally idempotent, which is verified by a test.

---

## 2. Ticket allocation

### The constraint

`FHE.randEuint64(bound)` **requires `bound` to be a power of two.** This is a property of the
library, and it is the single fact that shapes everything below.

A "one ticket per unit of weight" design is therefore unavailable: the total would be an
encrypted value, and the random bound must be a public power of two. Instead, tickets are
allocated inside a **fixed `2^k` space**.

```
0 ─────────────────────────────────────────────────────── 2^k
│ alice  │ bob │ carol │            unallocated            │
```

### The allocation

```solidity
tickets      = min(weight / weightPerTicket, 2^k / maxParticipants)
[start, end) = [cumulative, cumulative + tickets)
```

The per-participant cap is what makes the design sound. Because
`maxParticipants × (2^k / maxParticipants) ≤ 2^k`, the sum can never exceed the domain and
ranges can never overlap — without ever comparing an encrypted total against a public one,
which is not something FHE could do.

Two properties follow:

- **Anti-whale.** Past the cap, more capital stops buying more odds. In a savings product
  that is a feature worth having, not a limitation to apologise for.
- **Steady savers need no special case.** Their weight is already zero (the `select` in
  `_accrueWeight` saw to it), so they receive an empty range `[c, c)`. No random point can
  fall inside a zero-width interval. There is no branch on mode anywhere in the draw.

---

## 3. Prize derivation

At `finalizeRound`, tier amounts are derived from the encrypted pool using public shares:

```solidity
tierTotal = FHE.div(FHE.mul(pool, shareBps), 10_000);
perWinner = FHE.div(tierTotal, winnerCount);
```

Floor division at every step is what makes the solvency invariant hold:

```
jackpot × jCount + mid × mCount + small × sCount  ≤  pool
```

Configuration-time validation does the rest: shares must sum to at most 10,000 bps, and a
tier may not have winners without a share or a share without winners — the former would emit
meaningless zero-value draws, the latter would silently burn its allocation.

### Why the pool is published

The pool and tier amounts are marked publicly decryptable. This is the one place Sable
deliberately reveals a number, and the reasoning is worth stating plainly:

The pool is an **aggregate over all Lucky savers**, so publishing it exposes no individual
position. Keeping it secret would force `/draws` to show redacted boxes where a real prize
belongs — and a prize nobody can see is not a prize anyone can trust.

Individual positions never take the public path.

---

## 4. The draw

```solidity
euint64 point = FHE.randEuint64(2^k);   // bounded, power of two, in a transaction
```

Draw points are generated *after* ticket ranges are fixed, in their own transaction, so no
participant can react to a drawn value. Whoever submits that transaction cannot read the
numbers it produced — they are ciphertexts, and the sender is granted no permission over them.

That property is what makes it safe for `drawBatch`, like every other lifecycle call, to be
permissionless. Sending the draw transaction is not a privilege, because it confers no
knowledge and no influence: the randomness comes from the coprocessor, the comparison against
each ticket range happens under encryption, and the sender learns nothing either way. A saver
impatient for their own prize can run the draw themselves without gaining an edge in it.

Points are independent. A saver holding a wide range can win more than one prize in a round;
that is intended and is the same property a physical multi-prize draw has.

---

## 5. Settlement

```solidity
ebool isWinner = FHE.and(FHE.ge(point, start), FHE.lt(point, stop));
reward = FHE.add(reward, FHE.select(isWinner, tierPrize, zero));
```

**Every participant is evaluated against every point, and every participant is written to.**
Losers receive an encrypted zero rather than being skipped.

That symmetry is the privacy property, not an inefficiency:

- No winners list exists in storage.
- No event names an address.
- Gas cost and storage access patterns are identical for winners and losers.
- A wallet learns it won by decrypting its own reward, and nobody else can learn it at all.

The cursor is participant-granular so the reward handle is persisted once per account per
batch rather than once per draw point — ACL grants are storage writes in the ACL contract,
and doing fourteen per account would dominate the cost.

### Measured cost

| Phase | HCU per account | Accounts per transaction |
| --- | --- | --- |
| Eligibility | 2,055,596 | 8 |
| Ticket assignment | 1,027,008 | 16 |
| Settlement (14 points) | **7,560,448** | **2** |

Against a 20,000,000 unit ceiling. Settlement dominates and sets the batching. A
50-participant round takes ~25 settlement transactions — an operational cost, not a wall,
which is exactly why every phase is resumable.

---

## 6. Rollover

### Why it exists

A fixed `2^k` domain means some of the space is always unallocated. A jackpot point landing
there matches nobody. This is not an edge case to be engineered away — it is the unavoidable
consequence of the power-of-two constraint from §2.

The choice is what to do with it. Burning the jackpot would be wasteful; extending the round
would be complicated; revealing why nothing matched would leak the ticket boundaries. Rolling
it forward is the only option that is simultaneously honest, simple and privacy-preserving —
and it happens to make the product better.

### The mechanism

```solidity
ebool   hit      = FHE.lt(point, totalTickets);   // allocation is contiguous from 0
euint64 rollover = FHE.select(hit, zero, jackpotPrize);
```

The unmatched jackpot was never credited to anyone, so the tokens are still in the vault.
`openRound` folds the previous round's rollover into the new pool. Solvency is maintained
throughout — nothing is created and nothing is destroyed.

Both `hit` and `rollover` are made publicly decryptable so the ledger can state what
happened. See `FHE_SECURITY.md` §4 for why that one-bit disclosure is acceptable.

### Testing determinism

Randomness cannot be forced, so the tests construct scenarios where the outcome is certain:

- **Guaranteed win** — one participant, `maxParticipants = 1`, `weightPerTicket = 1`. Their
  range covers the entire domain, so every point must match.
- **Guaranteed rollover** — `weightPerTicket = 2^62`, so every weight floors to zero tickets.
  `totalTickets = 0`, and `lt(point, 0)` is false for every point.

Both are exact, repeatable, and assert real decrypted values.

---

## 7. Where the prize money comes from

The pool is fed exclusively by:

```solidity
euint64 lucky = FHE.select(isLucky, earned, zero);
```

`earned` is that interval's yield: `balance × publicIndexDelta / INDEX_SCALE`. It is bounded
above by the interest accrued, and there is no expression anywhere in the protocol that moves
principal into a reward.

This is why **Invariant 1** — a saver's principal can never become another saver's prize — is
a structural property of the code rather than a promise about intent.
