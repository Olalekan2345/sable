# Deployment

Deploying Sable to Ethereum Sepolia, operating a round, and verifying the confidential flows
against the live Zama Protocol.

---

## 1. Prerequisites

- Node 20.18+ and pnpm 9
- A funded Sepolia account (~0.3 ETH covers deployment and a full round comfortably)
- An RPC endpoint — a dedicated one is strongly recommended, since public endpoints
  rate-limit the log queries the activity view performs
- Optionally an Etherscan API key for source verification

```bash
pnpm install
cp .env.example .env
```

Fill in `DEPLOYER_PRIVATE_KEY`, `SEPOLIA_RPC_URL` and `ETHERSCAN_API_KEY`.

Use a throwaway key. It is a testnet, but a leaked key is a leaked key.

---

## 2. Deploy

```bash
pnpm contracts:compile
pnpm contracts:test        # 134 tests — do not deploy on a red suite
pnpm deploy:sepolia
```

`deploy:sable` deploys in dependency order and wires the contracts together.

On Sepolia it defaults to **Zama's published confidential asset**, `cUSDCMock`
(`0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`), rather than deploying one. It reads the
asset's decimals, rate and underlying from the chain and aborts if the decimals are not 6,
because Sable's accounting assumes them.

1. `SableReserveYieldAdapter` — reserve-backed yield for an asset Sable cannot mint
2. `Sable` — the vault, rounds and prize engine
3. `adapter.setVault(sable)` — only the vault may draw yield

Pass `--asset own` to deploy `SableConfidentialUSD` and the mint-based adapter instead; this
is the default on local chains, where Zama's contracts do not exist.

### Fund the reserve

**A reserve-backed deployment accrues no yield until it is funded.** That is deliberate — the
adapter will not credit yield it cannot pay — but it means a round opened before funding will
have an empty prize pool.

```bash
npx hardhat reserve:fund --amount 50000 --network sepolia
npx hardhat reserve:status --network sepolia
```

The task mints the underlying ERC-20 (public, one million per call), approves the adapter,
and wraps it into the reserve. `reserve:status` shows the funded total and the resulting
index ceiling.

It writes `deployments/sepolia.json` with real addresses, transaction hashes and deployment
blocks, then prints the environment lines for the web app.

```bash
pnpm sync:abis      # exports ABIs + addresses into @sable/config
pnpm verify:sepolia # verifies source on Etherscan
```

**`sync:abis` is not optional.** It is the only writer of `packages/config/src/generated/`,
which is where the web app and the indexer both read addresses from. Skipping it leaves the
app pointed at nothing, which it will render honestly as a "not deployed" state.

---

## 3. Configure and open the first round

Schedule a calendar of rounds rather than configuring them one at a time — the keeper opens
each when its turn comes, and a week signed in one sitting is what lets it run unattended:

```bash
cd packages/contracts

npx hardhat rounds:schedule --network sepolia   # 28 × 6h, the shipped defaults
npx hardhat keeper --network sepolia            # opens round 1 when its window arrives
npx hardhat round:status --id 1 --network sepolia
```

`round:configure` and `round:open` still exist for a one-off round.

### Choosing the ticket parameters

Three values interact, and the two that decide whether the draw is *fair* are the two most
often set carelessly:

```
tickets                          = min(weight / weightPerTicket, 2^k / maxParticipants)
weighting stays proportional to    2^k / maxParticipants  tickets
fraction of the domain allocated = actualParticipants / maxParticipants
```

**`weightPerTicket`** converts weight into tickets. Weight is `balance × minutes held`, so a
saver holding 1,000 cUSDC (`1e9` raw units) through a 6-hour round (360 minutes) has weight
~`3.6e11`; at `weightPerTicket = 1e6` that is 360,000 tickets.

**`ticketBits`** (`k`) sets the resolution, and with `maxParticipants` fixes the per-saver cap
at `2^k / maxParticipants`. A saver above the cap stops earning tickets, so if *everyone* caps
out the draw silently stops being deposit-weighted and becomes uniform — which is the one
property the whole design is supposed to provide. Size `k` so a *typical* saver lands well
below the cap.

**`maxParticipants`** decides how much of the domain a full round occupies, and therefore how
often the jackpot rolls over: with `n` actual savers, the jackpot finds an owner roughly
`n / maxParticipants` of the time. Setting it far above the real participant count does not
make the round safer — it makes the prize page look dead.

The defaults were `k = 16, maxParticipants = 50`, which failed both tests: the cap sat at
`2^16 / 50 = 1,310` tickets, reached at **3.6 cUSDC**, so essentially every real saver capped
out and the draw was uniform; and three savers allocated 6% of the domain, rolling the jackpot
over 94% of rounds.

The shipped defaults are **`k = 24`, `maxParticipants = 10`**, giving a cap of 1,677,721
tickets — proportional weighting up to ~4,660 cUSDC over a 6-hour round — and, with three
savers, jackpot/mid/small odds of roughly 30% / 66% / 97%.

Every value is public and inspectable on the round page, so the choice is auditable.

---

## 4. Running a round

In normal operation nothing is needed here: the keeper closes each round when its window
passes, walks it through to completion, and opens its successor in the same invocation.
`.github/workflows/keeper.yml` runs it every fifteen minutes; it needs a `KEEPER_PRIVATE_KEY`
secret holding a **throwaway key with a little Sepolia ETH and no role of any kind**. Never the
deployer key.

To advance a round by hand — because the keeper is not configured yet, or because you would
rather not wait for the next tick:

```bash
npx hardhat keeper --network sepolia            # permissionless; any funded key
npx hardhat round:run --id 1 --network sepolia  # the same phases, one specific round
```

Neither call requires a role. Every lifecycle step is permissionless, so a saver waiting on
their own prize can settle the round themselves.

Both drive every remaining phase, resuming from wherever the round currently is. They read
each cursor from chain state before acting, so an interrupted run picks up exactly where it
stopped — it will not repeat work or skip an account. `keeper` goes on to open the next
scheduled round once the current one completes; `round:run` stops at the round you named.

Batch sizes come from the HCU benchmark:

| Phase | Batch | Why |
| --- | --- | --- |
| Eligibility | 8 | ~2.06M HCU per account |
| Tickets | 16 | ~1.03M HCU per account |
| Draw | 14 | 336K total for the full ladder |
| Settlement | **2** | **~7.56M HCU per account** against a 20M ceiling |

Settlement dominates: at the shipped `maxParticipants = 10`, a full round is 5 settlement
transactions. Override with `--settle-batch` if the tier ladder changes, but re-measure first —
an oversized batch reverts with `HCUTransactionLimitExceeded`.

An oversized batch is **safe**: it reverts without advancing the cursor, so retrying smaller
just works. This is asserted by a test.

The `/admin` page performs the same operations through the browser. Only `configureRound` there
actually needs the admin wallet; the lifecycle calls are permissionless and will go through from
any connected account.

---

## 5. Verifying the confidential flows

Mock tests passing is not evidence that anything works against the real relayer. Walk this
through against the live deployment before treating a deployment as good.

### Setup

```bash
pnpm sync:abis
pnpm web:dev
```

Connect a wallet on Sepolia.

### Checklist

| # | Step | What to confirm |
| --- | --- | --- |
| 1 | Get cUSDCMock into the wallet | Either transfer some in, or bring the public `USDCMock` and use the app's wrap action (approve + wrap). `npx hardhat faucet` does it from the CLI |
| 2 | Authorise the vault | `setOperator` confirms |
| 3 | Deposit an amount | The UI walks through *encrypting → awaiting wallet → confirming*; encryption takes a visible moment |
| 4 | Open the transaction on Etherscan | **The calldata contains no plaintext amount.** This is the demonstration |
| 5 | Reveal your balance | EIP-712 signature, then the real figure resolves |
| 6 | Reveal the mode without setting it | Reads Lucky — the default a deposit gives you. Then set it explicitly and note the calldata |
| 7 | Set a second wallet to Steady | **Compare the two transactions — identical selector, identical calldata length, identical event** |
| 8 | Wait, then close and run the round | Follow `round:status` |
| 9 | Open `/draws/1` in a private window, no wallet | Real prize figures resolve via public decryption |
| 10 | Reveal rewards on each wallet | Only the owner can decrypt; a winner sees an amount, others zero |
| 11 | Withdraw | Confidential tokens return to the wallet |
| 11b | Unwrap | Three stages: burn, public decrypt, release. The public ERC-20 arrives |
| 12 | Generate a statement | PDF builds locally; check the network tab — no decrypted value is transmitted |

Step 4 and step 7 are the two that actually prove the product's claims. Do not skip them.

---

## 6. Deploying the web app

The app is a standard Next.js application. Any platform supporting Next 16 works.

```bash
pnpm --filter @sable/web build
pnpm --filter @sable/web start
```

Two deployment-specific requirements:

**The relayer SDK must be copied into `public/`.** The `prebuild` script does this
automatically. It exists because the SDK's ~5.4 MB of WASM cannot be put through the bundler:
doing so takes the production build from 43 seconds to over twenty minutes. It is served as a
static asset and loaded at runtime instead. If `/relayer-sdk/relayer-sdk-js.umd.cjs` 404s,
run `pnpm --filter @sable/web sdk:copy`.

**Cross-origin isolation headers matter.** `next.config.mjs` sets `Cross-Origin-Opener-Policy`
and `Cross-Origin-Embedder-Policy`, which the SDK needs for `SharedArrayBuffer` and its
multi-threaded path. Without them encryption still works but is noticeably slower — which
savers feel directly at the deposit step. If your platform strips these, re-add them at the
edge.

---

## 7. Running the indexer (optional)

The indexer archives public round metadata. **The application is fully functional without
it** — it reads directly from the chain.

```bash
createdb sable
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/sable

pnpm --filter @sable/indexer db:push
pnpm --filter @sable/indexer start
```

Serves on `:4000` with `/health`, `/rounds`, `/rounds/:id` and `/accounts/:address/events`.

It stores no confidential data. The schema has no columns for balance, mode, weight, ticket
range or reward — a structural property, not a policy.

---

## 8. Operational notes

### Yield

The adapter publishes a rate and issues the test asset against real elapsed time. Change it
with:

```bash
npx hardhat --network sepolia run --no-compile <<< "adapter.setRate(500)"
```

`setRate` accrues the index to the present *before* changing the rate, so a rate change never
retroactively re-prices interest that already accrued.

The index has a hard ceiling of 5× its starting value. That is not a policy — it is what keeps
`balance × indexDelta` inside `euint64`, where overflow would wrap silently.

### Pausing

`setPaused(true)` halts deposits and mode changes. **Withdrawals are deliberately not
gated.** A pause that trapped principal would make the product's central promise conditional
on operator behaviour.

### Participant cap

`setParticipantCap` raises the ceiling. It cannot be lowered below the number already
registered, because batch cursors iterate the existing registry.

The cap is an operational choice, not a technical wall: more participants simply mean more
settlement transactions.

---

## 9. Troubleshooting

| Symptom | Cause |
| --- | --- |
| `HCUTransactionLimitExceeded` | Batch too large. Reduce it; the cursor did not move |
| `Unexpected ZamaConfig.sol file` at compile | `@fhevm/solidity` was bumped past 0.11.1. See `ZAMA_IMPLEMENTATION_NOTES.md` §2 |
| App shows "not deployed" | `pnpm sync:abis` was not run after deploying |
| Encryption hangs in the browser | `/relayer-sdk/` is not being served, or COOP/COEP headers were stripped |
| `getLogs` failures in Activity | RPC rate limit. Use a dedicated endpoint |
| Deposit confirms but the balance is unchanged | The wallet could not cover it. ERC-7984 transfers are all-or-nothing and return an encrypted zero rather than reverting |
| `InvalidRoundState` from the admin page | The round advanced since the page loaded. Refresh |
