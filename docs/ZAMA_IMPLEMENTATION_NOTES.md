# Zama Implementation Notes

> **Phase 1 deliverable.** Every API choice below was verified against the *installed*
> packages in this repository, not against blog posts or older tutorials. Where a
> common assumption turned out to be wrong, the correction is recorded.

Verification date: 2026-08-31.

---

## 1. Locked version matrix

| Package | Version | Why this exact version |
| --- | --- | --- |
| `@fhevm/solidity` | **0.11.1** | See [§2](#2-the-0133-trap). `0.13.x` is published but **incompatible** with the current Hardhat plugin. |
| `@fhevm/hardhat-plugin` | **0.4.2** | Latest. Declares `@fhevm/solidity@^0.11.1` as a peer — the range is accurate, not stale. |
| `@fhevm/mock-utils` | **0.4.2** | Pinned by the plugin (exact `0.4.2`). |
| `@zama-fhe/relayer-sdk` | **0.4.1** (contracts) / **0.4.4** (web) | The plugin pins `0.4.1` exactly. The web app is not bound by that peer and uses the latest stable `0.4.4`. |
| `encrypted-types` | **0.0.4** | Provides `externalEuint64` / `externalEbool`. |
| `@openzeppelin/confidential-contracts` | **0.5.3** | ERC-7984. Independently peers `@fhevm/solidity` at **exactly `0.11.1`** — corroborates the pin. |
| `hardhat` | **2.29.x** | Plugin peers `hardhat@^2.0.0`. Hardhat 3 is **not** supported. |
| Solidity | **0.8.27**, `evmVersion: cancun` | Matches the FHEVM toolchain's expectations. |

### Reproducing the check

```bash
node -p "require('@fhevm/solidity/package.json').version"   # 0.11.1
pnpm contracts:test                                         # mock FHEVM coprocessor
```

---

## 2. The 0.13.3 trap

`npm view @fhevm/solidity version` reports `0.13.3` as `latest`. Installing it and
compiling fails:

```
Error in plugin @fhevm/hardhat-plugin: Unexpected ZamaConfig.sol file.
File located at '.../@fhevm/solidity/config/ZamaConfig.sol' has changed and is not
supported (ethereum).
```

**Root cause.** The plugin does not merely *read* `ZamaConfig.sol` — it *parses and
rewrites* it into `fhevmTemp/@fhevm/solidity/config/ZamaConfig.sol`, substituting mock
coprocessor addresses (see
`@fhevm/hardhat-plugin/_types/internal/deploy/ZamaConfigDotSol.d.ts`). `0.13.x` added
Polygon / Amoy branches and changed the file's shape, so the parser rejects it.

**Consequence.** "Install the newest package" is the wrong instinct here. The matrix is
locked by the *plugin*, and `@openzeppelin/confidential-contracts` independently agrees
on `0.11.1`. Do not bump `@fhevm/solidity` without re-running a compile.

---

## 3. Configuration contract: `ZamaEthereumConfig`, not `SepoliaConfig`

Many tutorials show:

```solidity
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
contract MyContract is SepoliaConfig { }
```

In the installed `0.11.1` there is **no** `SepoliaConfig` contract — `_getSepoliaConfig()`
is a `private` library function. The inheritable contracts are:

- `ZamaEthereumConfig` — routes on `block.chainid`: mainnet (1), Sepolia (11155111), local (31337)
- `ZamaPolygonConfig`
- `ZamaMultiChainConfig`

Sable inherits **`ZamaEthereumConfig`**, which is what lets the *same* bytecode run under
the Hardhat mock and on Sepolia with no conditional code.

### Verified Sepolia system addresses

Read out of `ZamaConfig.sol` and cross-checked against the Relayer SDK's runtime
`SepoliaConfig` export — the two agree, which is a useful consistency check:

| Contract | Address |
| --- | --- |
| ACL | `0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D` |
| Coprocessor (`FHEVMExecutor`) | `0x92C920834Ec8941d2C77D188936E1f7A6f49c127` |
| KMSVerifier | `0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A` |
| InputVerifier | `0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0` |
| Decryption (EIP-712 verifying contract) | `0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478` |
| InputVerification (EIP-712 verifying contract) | `0x483b9dE06E4E4C7D35CCf5837A1668487406D955` |
| Relayer URL | `https://relayer.testnet.zama.org` |
| Gateway chain id | `10901` |

**None of these are hardcoded in Sable's own source.** Solidity obtains them from
`ZamaEthereumConfig`; the web app obtains them from the SDK's exported `SepoliaConfig`.

---

## 4. Encrypted randomness — the power-of-two constraint

Verified in `FHE.sol`:

```solidity
/// Generates a random encrypted 64-bit unsigned integer in the [0, upperBound) range.
/// The upperBound must be a power of 2.
function randEuint64(uint64 upperBound) internal returns (euint64);
```

This is a hard constraint, and it is **the reason Sable's ticket domain is a fixed `2^k`
space** rather than "one ticket per unit of weight". The jackpot rollover mechanic is a
direct product consequence of that cryptographic constraint, not a decorative feature.

`randEuint*` mutates coprocessor state, so it only works inside a **transaction** — it
cannot be called from `eth_call`. Sable's draw is therefore an explicit transaction, and
`block.timestamp` / `blockhash` / `prevrandao` appear nowhere in winner selection.

---

## 5. Public decryption without the oracle package

Sable needs exactly **one** public number per round: the aggregate prize pool, so that
`/draws` can show a real value instead of a redacted box.

The obvious route is `@zama-fhe/oracle-solidity` plus an async callback. It was rejected:
its peer set conflicts with this repo (`@openzeppelin/contracts` pinned to `5.1.0`
against our `^5.6.1`, `@fhevm/solidity@^0.8.0`, plus `hardhat-deploy`), and it would add
an asynchronous callback state to the round machine for a single scalar.

**Chosen instead:** `FHE.makePubliclyDecryptable(euint64)`.

The contract marks the aggregate publicly decryptable at round close; any client then
resolves the plaintext through the relayer's `publicDecrypt`. The value is authorised by
the on-chain ACL, so it is genuine protocol state — not a number the frontend invented.

This yields both decryption paths in one product, which is precisely the demonstration
the bounty asks for:

| Path | Used for | Who can read |
| --- | --- | --- |
| **Public decryption** (`makePubliclyDecryptable` → `publicDecrypt`) | Round prize pool, per-tier amounts | Anyone, no wallet needed |
| **User decryption** (ACL `allow` → EIP-712 → `userDecrypt`) | Balance, mode, weight, rewards | The owning wallet only |

Individual positions never take the public path.

---

## 6. Verified FHE API surface used by Sable

All confirmed present in the installed `0.11.1`:

| Purpose | Call |
| --- | --- |
| Ingest ciphertext + ZK proof | `FHE.fromExternal(externalEuint64, bytes)`, `FHE.fromExternal(externalEbool, bytes)` |
| Arithmetic (ct × ct) | `add`, `sub`, `mul` |
| Arithmetic (ct × plaintext) | `add`, `sub`, `mul`, `div`, `rem` — **`div` is scalar-only** |
| Comparison | `eq`, `ne`, `ge`, `gt`, `le`, `lt` → `ebool` |
| Boolean | `and`, `or`, `xor`, `not` |
| Branchless branch | `select(ebool, T, T)` for `ebool`/`euint8..128`/`eaddress`/`euint256` |
| Clamping | `min`, `max` |
| Bounded randomness | `randEuint64(pow2)`, `randEuint32(pow2)` |
| Trivial encryption | `asEuint64(uint64)`, `asEbool(bool)` |
| Casts | `asEuint64(euint128)`, `asEuint128(euint64)` |
| Init guard | `isInitialized(euint64)` |
| ACL | `allow`, `allowThis`, `allowTransient`, `isAllowed`, `isSenderAllowed`, `makePubliclyDecryptable` |

**There is no encrypted-by-encrypted division.** This single fact shaped the entire yield
model: Sable can never compute `luckyYield / totalYield` homomorphically, so it attributes
yield *per user* against a *public* index instead. See `docs/PRIZE_ENGINE.md`.

---

## 7. ERC-7984 semantics that changed the vault design

From `IERC7984`:

```solidity
function confidentialBalanceOf(address account) external view returns (euint64);
function confidentialTransferFrom(address from, address to, euint64 amount)
    external returns (euint64 transferred);
function setOperator(address operator, uint48 until) external;
```

Three consequences:

1. **Money is `euint64`.** Sable uses `euint64` for every monetary quantity, so no cast is
   ever needed at the token boundary.
2. **Transfers do not revert on insufficient funds — they return the amount actually
   moved.** A vault that credited the *requested* amount would mint value from nothing.
   `SableVault` credits the **returned `transferred` handle**, always. This is the single
   most important correctness detail in the deposit path.
3. **Approval is operator-based with an expiry**, not an allowance. The deposit flow in
   the web app is therefore `setOperator(vault, until)` → `deposit(...)`.

---

## 8. Test-time API (`@fhevm/hardhat-plugin`)

```ts
import { FhevmType } from "@fhevm/hardhat-plugin";

const enc = await fhevm.createEncryptedInput(contractAddr, userAddr).add64(1234n).encrypt();
await contract.deposit(enc.handles[0], enc.inputProof);

const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddr, signer);
const flag  = await fhevm.userDecryptEbool(handle, contractAddr, signer);
const pub   = await fhevm.publicDecryptEuint(FhevmType.euint64, handle);
```

`FhevmType` is re-exported by the plugin (`ebool = 0 … euint64 = 5 …`).

`fhevm.computeTransactionHCU(receipt)` returns the homomorphic-complexity cost of a
transaction. `test/benchmark.hcu.ts` uses it to size batches **empirically** rather than
assuming a participant cap.

---

## 9. Browser API (`@zama-fhe/relayer-sdk@0.4.4`)

Entry point is `@zama-fhe/relayer-sdk/web` (`/bundle` and `/node` builds also exist).

```ts
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/web";

await initSDK();                                     // loads TFHE + KMS WASM
const instance = await createInstance({ ...SepoliaConfig, network: window.ethereum });
```

- `instance.createEncryptedInput(contract, user)` → `.add64()` / `.addBool()` / `.encrypt()`
- `instance.generateKeypair()`, `instance.createEIP712(...)`, `instance.userDecrypt(...)`
- `instance.publicDecrypt(handles)`

`initSDK()` loads WebAssembly, so it must run **client-side only** and be lazy-loaded. In
Next.js it sits behind a `dynamic(..., { ssr: false })` boundary, and the WASM is fetched
only when a user first performs a confidential action — never on the landing page.

---

## 10. Things deliberately not used

| Rejected | Reason |
| --- | --- |
| `TFHE.*` API | Belongs to a pre-`FHE.*` generation of the library. Not present in 0.11.1. |
| `fhevmjs` | Superseded by `@zama-fhe/relayer-sdk`. |
| `SepoliaConfig` **contract** | Does not exist in 0.11.1 (see §3). |
| `@zama-fhe/oracle-solidity` | Peer-dependency conflict plus needless async state (see §5). |
| `euint128` for balances | ERC-7984 is `euint64`; casting at every boundary costs HCU for no benefit. Overflow is prevented structurally instead — see `docs/FHE_SECURITY.md`. |
| Encrypted ÷ encrypted | Not available in the library. Yield uses a public index. |
