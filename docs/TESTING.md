# Testing

134 contract tests across eight suites, run against the FHEVM mock coprocessor. This document
covers what is tested, and — more usefully — the FHE-specific testing problems that had to be
solved to test it at all.

```bash
pnpm contracts:test                    # everything
pnpm --filter @sable/contracts test test/weighting.ts   # one suite
REPORT_GAS=true pnpm contracts:test    # with a gas report
```

---

## 1. Suites

| File | Tests | Covers |
| --- | --- | --- |
| `test/vault.ts` | 29 | Deposits, ACL, confidential mode, withdrawals |
| `test/weighting.ts` | 11 | Time-weighted eligibility, exact arithmetic |
| `test/rounds.ts` | 30 | Configuration validation, state machine, authorisation |
| `test/prizes.ts` | 18 | Yield routing, tiers, draw, settlement, rollover, claiming |
| `test/invariants.ts` | 9 | End-to-end protocol invariants and solvency |
| `test/benchmark.hcu.ts` | 4 | Measured homomorphic cost, batch sizing |
| `test/wrapped-asset.ts` | 15 | Zama's `cUSDCMock` asset shape, reserve-backed yield, solvency bound |
| `test/wrap-unwrap.ts` | 10 | The public/confidential boundary, including a full round trip |

---

## 2. The problems specific to testing FHE

### Randomness cannot be forced

There is no way to make `FHE.randEuint64` return a chosen value, so "does the winner get
paid?" cannot be tested directly. The tests instead construct configurations where the
outcome is **certain**:

```ts
/** The full ticket domain fits one participant, so every draw point must land on them. */
const CERTAIN_WIN  = { maxParticipants: 1, ticketBits: 16, weightPerTicket: 1n };

/** A divisor so large every weight floors to zero tickets, so every point must miss. */
const CERTAIN_MISS = { maxParticipants: 1, ticketBits: 16, weightPerTicket: 1n << 62n };
```

Both are deterministic and repeatable, and both assert real decrypted values rather than
"greater than zero".

### An unwritten handle is not decryptable

The contract skips FHE work rather than storing an encrypted zero, so an untouched slot reads
back as the zero handle — which the relayer cannot decrypt and should not be asked to.

This surfaced as a genuine test failure and produced a real frontend requirement: a
brand-new account must render `0.00`, not an error. Both the test helper and the web app now
normalise it:

```ts
if (handle === ethers.ZeroHash) return 0n;
```

### A reverting transaction can confuse the mock provider

When a transaction reverts *before* consuming its encrypted input, the FHEVM mock provider
raises its own error instead of the contract's revert data, so
`revertedWithCustomError` cannot match.

Assertions for those paths use `staticCall`, which never reaches the provider's send path:

```ts
await expect(
  d.sable.connect(d.alice).deposit.staticCall(handle, proof),
).to.be.revertedWithCustomError(d.sable, "Paused");
```

### Exactness requires controlling time

Weight is `balance × whole minutes`, so a test that lets timestamps drift can only assert
inequalities. Every weighting test pins timestamps with `time.setNextBlockTimestamp` and
asserts an exact product:

```ts
const expected = AMOUNT * minutesBetween(depositAt, closesAt);
expect(await weightOf(d, roundId, d.alice)).to.equal(expected);
```

Inequality assertions were deliberately avoided here — `greaterThan(0)` would keep passing
through a regression in checkpoint ordering, which is precisely the bug this suite exists to
catch.

### The unwrap flow cannot be tested as one call

Unwrapping is three steps, and the middle one is off-chain. The suite drives all three
rather than hiding them behind a helper, because the interesting failures live between them:

```ts
const enc = await fhevm.createEncryptedInput(wrapper, account).add64(amount).encrypt();
await wrapper["unwrap(address,address,bytes32,bytes)"](from, to, enc.handles[0], enc.inputProof);

const proven = await fhevm.publicDecrypt([requestId]);   // value AND proof
await wrapper.finalizeUnwrap(requestId, proven.clearValues[requestId], proven.decryptionProof);
```

`finalizeUnwrap` runs `FHE.checkSignatures` over the KMS proof, so a test that only fetched
the value would fail — which is the point: it proves the proof is real rather than decorative.

One test deliberately asserts the *ordering*: after step 1 the confidential balance is
already debited while the public balance is still zero. That gap is what makes an interrupted
unwrap recoverable rather than a lost balance, and it is worth pinning.

`unwrap` is overloaded (with and without an input proof), so calls use the explicit
`["unwrap(address,address,bytes32,bytes)"]` signature — ethers cannot disambiguate otherwise.

---

---

## 3. What each invariant test asserts

| Invariant | Test |
| --- | --- |
| 1 — principal never becomes another's prize | Mixed round; every saver's balance ≥ their principal afterwards |
| 2 — only Lucky yield funds the pool | Steady saver's balance grows; Lucky savers' do not; pool ≈ 2× the Steady saver's yield |
| 3 — mode never publicly revealed | `publicDecrypt` on a mode handle is rejected |
| 4 — balance never publicly revealed | `publicDecrypt` on balance, weight and reward handles is rejected |
| 5 — never distributes more than the pool | Sum of credited rewards + rollover ≤ pool |
| 6 — completed round cannot re-run | Every lifecycle call on a COMPLETE round reverts |
| 7 — reward cannot be credited twice | Claiming twice leaves the balance unchanged |
| 8 — no cross-account decryption | Decryption attempts by other accounts and by an unrelated observer are rejected |

Plus **solvency**: after a settled round, all three savers claim and fully withdraw, and
their wallet balances reconcile exactly. That is the strongest practical solvency statement
available when every balance is a ciphertext — if everyone can drain their position, the
vault genuinely custodied what it credited.

---

## 4. Confidentiality assertions

Privacy is asserted mechanically, not reviewed by eye:

```ts
it("produces identical calldata shape and identical logs for both modes", ...)
it("exposes no mode-revealing function on the ABI", ...)
it("emits an event that carries no amount", ...)
it("never reveals a winner in an event", ...)
it("credits a losing saver an encrypted zero rather than skipping them", ...)
```

The ABI test greps the entire interface for `lucky` and `steady` and fails if either appears
in any function or event name — which would catch a future contributor adding a convenience
method that undoes the whole design.

---

## 5. The HCU benchmark

`test/benchmark.hcu.ts` exists because the brief said not to assume a participant cap. It
measures rather than guesses, and the mock enforces the same ceilings as the live network, so
an oversized batch reverts here exactly as it would on Sepolia.

```
┌────────────────────────────────────────┬──────────┬──────────────┬─────────────┐
│ phase                                  │ accounts │ globalHCU    │ depth       │
├────────────────────────────────────────┼──────────┼──────────────┼─────────────┤
│ setMode                                │ 1        │ 96           │ 32          │
│ deposit                                │ 1        │ 1,129,096    │ 750,032     │
│ withdraw                               │ 1        │ 1,129,032    │ 588,000     │
│ processEligibilityBatch (4 accounts)   │ 4        │ 8,222,384    │ 1,783,000   │
│ finalizeRound                          │ 0        │ 5,385,000    │ 1,795,000   │
│ assignTicketsBatch (4 accounts)        │ 4        │ 4,108,032    │ 1,513,000   │
│ drawBatch (14 points)                  │ 0        │ 336,000      │ 24,000      │
│ settleBatch (1 account x 14 points)    │ 1        │ 7,560,448    │ 2,500,000   │
│ settleBatch (2 accounts x 14 points)   │ 2        │ 15,120,896   │ 2,500,000   │
│ completeRound                          │ 0        │ 388,096      │ 363,000     │
└────────────────────────────────────────┴──────────┴──────────────┴─────────────┘
```

Against the protocol's 20,000,000 global / 5,000,000 depth ceilings
(`@fhevm/host-contracts/contracts/HCULimit.sol`).

**Headline result:** settlement costs ~7.56M per account, so at most **two accounts per
transaction**. A dedicated test asserts that four reverts, that the cursor does *not* advance,
and that a batch of two then succeeds — proving the failure is recoverable rather than
corrupting.

Note that depth stays flat at 2.5M as the batch grows: participants are independent, so
global HCU is the binding constraint, not sequential depth.

---

## 6. Frontend testing

`pnpm --filter @sable/web typecheck` runs the full TypeScript check under `strict` with
`noUncheckedIndexedAccess`.

`pnpm --filter @sable/web build` is itself a meaningful test: all 22 routes are built,
which exercises every server component and every module import path.

### Unit suite

`pnpm --filter @sable/web test` runs 21 vitest specs covering the shielding arithmetic and token-symbol normalisation — the
conversion between a public token and the confidential one, which is where a factor-of-ten
error would be both easy to make and expensive to miss. The cases that matter are the ones
the confidential-side helpers get wrong if reused directly: eighteen-decimal underlyings, and
wrappers whose `rate` is not one.

### Browser suite

`pnpm --filter @sable/web e2e` runs the six spec files across desktop Chrome and a Pixel 7
viewport — **97 test runs: 95 passing, 2 skipped.**

Both skips are conditional and deliberate. One is scoped to a single project (a phone
navigation bar has nothing to assert on desktop). The other needs the connected wallet to have
on-chain history and skips when it has none, because asserting on an empty timeline would
prove nothing — the helper waits for the first entry and lets the caller decide, rather than
passing vacuously.

The suite covers the surfaces that work without a wallet, which are exactly the surfaces a
first-time visitor sees and the ones least likely to be re-checked while testing connected
flows manually. Notably it asserts things a build cannot:

```ts
it("shows no fabricated prize amounts before a round exists")
it("shows an honest empty state rather than sample rounds")
it("privacy page is explicit about what is NOT protected")
it("does not claim to be zero-knowledge")
it("never exposes participant columns")
it("contacts no analytics endpoint before a wallet is connected")
it("states plainly that the balance being shielded is public")
```

The shield specs go further and exercise a connected wallet. Every RPC call passes through to
Sepolia; exactly one value is rewritten — the `balanceOf` result inside the Multicall3 batch —
because the synthetic test wallet holds no USDCMock. It could mint some: the app carries a
*Get test tokens* button and `npx hardhat faucet` does the same from the CLI. Rewriting one
read is preferred anyway, because a spec that mints on Sepolia spends gas, depends on a live
faucet contract to pass, and leaves the wallet in a different state on every run. The
wrapper's `underlying`, `rate`, pause and denylist state, and both token symbols are genuinely
fetched, so a break in the real integration still fails the suite.

Those five exist to make the no-fake-data and no-overclaiming rules **mechanically
enforced** rather than a matter of discipline. A future redesign that introduced a
placeholder `$50,000` jackpot, or quietly trimmed the metadata-leakage section from the
privacy page, fails CI.

Accessibility is asserted too: a working skip link as the first tab stop, exactly one `h1`
per page, no unlabelled SVG reaching the accessibility tree, and no horizontal overflow at
375px. The unlabelled-SVG assertion caught three real defects when first written.

Wallet-dependent flows are deliberately not simulated. Stubbing an injected provider would
test the stub — the encryption, the relayer round trip and the wallet signature are the
parts that carry risk, and none survive being mocked. Those are verified against a live
deployment using the checklist in `DEPLOYMENT.md`.

---

## 7. What is not covered

Stated plainly rather than implied by omission:

- **No external audit.**
- **No fuzz or invariant-property testing.** The invariants are asserted on specific
  scenarios, not explored automatically.
- **No fork testing.** The mock coprocessor is faithful to the HCU limits and the ACL, but it
  is not the live Zama infrastructure. Mock tests passing is not proof that a flow works
  against the real relayer — the Sepolia walkthrough in `DEPLOYMENT.md` exists for that
  reason.
- **No automated coverage of wallet-connected flows.** Deposit, withdraw, mode change,
  reveal and claim require a funded wallet and a live relayer; they are verified manually
  against the deployment checklist, not in CI.
