// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, ebool, externalEuint64, externalEbool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {SableAccessControl} from "./SableAccessControl.sol";
import {ISableYieldAdapter} from "../interfaces/ISableYieldAdapter.sol";
import {SableErrors} from "../libraries/SableErrors.sol";
import {SableMath} from "../libraries/SableMath.sol";
import {SableTypes} from "../libraries/SableTypes.sol";

/**
 * @title  SableCore
 * @notice Storage, configuration and the confidential primitives shared by every Sable layer.
 * @dev    ## Why one deployed contract
 *
 *         Sable's vault, round machine and prize engine are written as three source files
 *         but compile into a single deployed contract. That is a deliberate reversal of
 *         the usual "one concern, one contract" instinct, for one reason: **ciphertexts do
 *         not cross contract boundaries for free.** Every handle passed between contracts
 *         needs an `FHE.allowTransient` grant on the way out and a permission check on the
 *         way back, on every call, in both directions. Splitting the vault from the prize
 *         engine would mean granting the prize engine transient access to every
 *         participant's balance and mode on every batch — a strictly larger ACL surface,
 *         more HCU, and considerably more to audit, in exchange for a diagram that looks
 *         tidier. Keeping all confidential state inside one ACL domain is both cheaper and
 *         safer.
 *
 *         The genuinely separate contracts are the ones with genuinely separate trust
 *         boundaries: the confidential asset (ERC-7984) and the yield adapter.
 *
 *         ## Layering
 *
 *         `SableCore` → `SableVault` → `SablePrizeEngine` → `Sable`
 *
 *         Storage lives here so that the vault's checkpoint logic and the prize engine's
 *         batch logic can share the round window without accessor indirection.
 */
abstract contract SableCore is SableAccessControl, ZamaEthereumConfig {
    // -------------------------------------------------------------------------
    // Immutable wiring
    // -------------------------------------------------------------------------

    /// @notice The confidential (ERC-7984) asset savers deposit.
    IERC7984 public immutable asset;

    // -------------------------------------------------------------------------
    // Protocol configuration
    // -------------------------------------------------------------------------

    /// @notice Source of the public yield index.
    ISableYieldAdapter public yieldAdapter;

    /// @notice Hard cap on registered participants across the protocol.
    /// @dev    Sized from measured HCU cost, not guessed. See `test/benchmark.hcu.ts`.
    uint32 public participantCap;

    /// @notice Most recent yield index observed from the adapter.
    uint64 public yieldIndex;

    // -------------------------------------------------------------------------
    // Participant registry
    // -------------------------------------------------------------------------

    /// @dev Append-only. Accounts are never removed, so indices stay stable and every
    ///      cursor-based batch can treat `_participants[0 .. participantCount)` as a
    ///      consistent snapshot without copying the array.
    address[] internal _participants;

    /// @dev One-based slot; zero means "not registered".
    mapping(address account => uint256 slot) internal _participantSlot;

    // -------------------------------------------------------------------------
    // Confidential account state
    // -------------------------------------------------------------------------

    mapping(address account => SableTypes.Position position) internal _accounts;

    /// @notice Yield index each account has already been credited up to.
    mapping(address account => uint64 index) public userYieldIndex;

    /// @notice Timestamp of each account's last checkpoint.
    mapping(address account => uint64 timestamp) public lastCheckpointAt;

    /// @dev Encrypted sum of all principal held by the vault. Used to size the yield draw.
    euint64 internal _totalDeposits;

    /// @dev Lucky-attributed yield accrued while no round is open. Folded into the pool
    ///      of the next round that opens, so no yield is ever stranded or double-counted.
    euint64 internal _carryPool;

    // -------------------------------------------------------------------------
    // Round state
    // -------------------------------------------------------------------------

    /// @notice Number of rounds ever configured. Round ids are 1-based.
    uint256 public roundCount;

    /// @notice Round currently accepting eligibility, or 0 when none is open.
    uint256 public activeRoundId;

    mapping(uint256 roundId => SableTypes.RoundConfig) internal _roundConfig;
    mapping(uint256 roundId => SableTypes.RoundState_) internal _roundState;
    mapping(uint256 roundId => SableTypes.RoundCiphertexts) internal _roundCiphers;

    /// @dev Mode-gated, time-weighted eligibility per round.
    mapping(uint256 roundId => mapping(address account => euint64)) internal _roundWeight;

    /// @dev Half-open ticket range `[start, end)` per round.
    mapping(uint256 roundId => mapping(address account => euint64)) internal _ticketStart;
    mapping(uint256 roundId => mapping(address account => euint64)) internal _ticketEnd;

    /// @dev Encrypted random points drawn for each round.
    mapping(uint256 roundId => euint64[]) internal _drawPoints;

    /// @dev Prize amount handle applicable to each draw point, by tier.
    mapping(uint256 roundId => SableTypes.Tier[]) internal _drawTiers;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    //
    // Confidentiality rule for this section: an event may reveal *that* an account acted
    // and *when*, because both are already visible in the transaction itself. An event may
    // never reveal *how much* or *which mode*. There is deliberately no `Deposited(user,
    // amount)` and no `LuckyModeEnabled(user)` anywhere in this protocol.

    /// @notice An account made a confidential deposit. Amount intentionally omitted.
    event PrivateDeposit(address indexed account);

    /// @notice An account made a confidential withdrawal. Amount intentionally omitted.
    event PrivateWithdrawal(address indexed account);

    /// @notice An account updated its confidential yield mode.
    /// @dev    Emitted identically for Steady and Lucky. The selection is not observable
    ///         from this log, from the function selector, or from the calldata shape.
    event PrivateModeUpdated(address indexed account);

    /// @notice An account moved confidential rewards into its savings balance.
    event PrivateRewardsClaimed(address indexed account);

    /// @notice An account joined the participant registry.
    event ParticipantRegistered(address indexed account, uint32 index);

    /// @notice The yield adapter was replaced.
    event YieldAdapterSet(address indexed adapter);

    /// @notice The participant cap was changed.
    event ParticipantCapSet(uint32 cap);

    // -------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------

    /**
     * @param asset_        ERC-7984 confidential asset accepted by the vault.
     * @param adapter       Yield index source.
     * @param admin         Initial admin and operator.
     * @param cap           Initial participant cap.
     */
    constructor(
        IERC7984 asset_,
        ISableYieldAdapter adapter,
        address admin,
        uint32 cap
    ) SableAccessControl(admin) {
        if (address(asset_) == address(0) || address(adapter) == address(0)) {
            revert SableErrors.ZeroAddress();
        }
        if (cap == 0) revert SableErrors.InvalidParticipantCap(cap);

        asset = asset_;
        yieldAdapter = adapter;
        participantCap = cap;
        yieldIndex = SableMath.INDEX_SCALE;

        emit YieldAdapterSet(address(adapter));
        emit ParticipantCapSet(cap);
    }

    // -------------------------------------------------------------------------
    // Administration
    // -------------------------------------------------------------------------

    /**
     * @notice Points the vault at a new yield index source.
     * @dev    The adapter can move the public index; it can never read or move user funds.
     */
    function setYieldAdapter(ISableYieldAdapter adapter) external onlyRole(ADMIN_ROLE) {
        if (address(adapter) == address(0)) revert SableErrors.ZeroAddress();
        yieldAdapter = adapter;
        emit YieldAdapterSet(address(adapter));
    }

    /**
     * @notice Adjusts the participant cap.
     * @dev    Cannot be lowered below the number already registered, because batch cursors
     *         iterate the existing registry.
     */
    function setParticipantCap(uint32 cap) external onlyRole(ADMIN_ROLE) {
        if (cap == 0 || cap < _participants.length) revert SableErrors.InvalidParticipantCap(cap);
        participantCap = cap;
        emit ParticipantCapSet(cap);
    }

    // -------------------------------------------------------------------------
    // Public views
    // -------------------------------------------------------------------------

    /// @notice Number of registered participants.
    function participantCount() external view returns (uint256) {
        return _participants.length;
    }

    /// @notice Returns whether `account` is registered.
    function isParticipant(address account) public view returns (bool) {
        return _participantSlot[account] != 0;
    }

    /// @notice Returns the registered participant at `index`.
    function participantAt(uint256 index) external view returns (address) {
        return _participants[index];
    }

    // -------------------------------------------------------------------------
    // Internal: ciphertext helpers
    // -------------------------------------------------------------------------

    /// @dev A fresh trivially-encrypted zero. Cheapest FHE operation available.
    function _zero() internal returns (euint64) {
        return FHE.asEuint64(0);
    }

    /**
     * @dev Adds `delta` to a possibly-uninitialised accumulator.
     *
     *      An unset `euint64` is the zero handle, and arithmetic on it is not meaningful,
     *      so every accumulator in Sable goes through this helper rather than being
     *      eagerly initialised. That keeps first-touch gas down without scattering
     *      `isInitialized` checks through the business logic.
     */
    function _accumulate(euint64 acc, euint64 delta) internal returns (euint64) {
        return FHE.isInitialized(acc) ? FHE.add(acc, delta) : delta;
    }

    /**
     * @dev Grants the contract permanent access to `value` and the account read access.
     *
     *      Called after **every** mutation of a persistent, user-owned ciphertext. Two
     *      grants are required and both matter:
     *
     *      - `allowThis` keeps the contract able to compute on the handle in later
     *        transactions. Without it the next round's arithmetic reverts.
     *      - `allow(value, account)` is what lets the owner — and only the owner — run the
     *        EIP-712 user-decryption flow against it.
     *
     *      Re-granting on every mutation is mandatory, not defensive: an FHE operation
     *      produces a *new handle*, and permissions attach to handles, not to slots.
     */
    function _persist(euint64 value, address account) internal {
        FHE.allowThis(value);
        FHE.allow(value, account);
    }

    /// @dev {_persist} for encrypted booleans.
    function _persistBool(ebool value, address account) internal {
        FHE.allowThis(value);
        FHE.allow(value, account);
    }

    // -------------------------------------------------------------------------
    // Internal: registry
    // -------------------------------------------------------------------------

    /**
     * @dev Registers `account` on first interaction and initialises its ciphertexts.
     *
     *      Mode defaults to Lucky, so depositing is what enters a saver into the draw. That
     *      default is itself encrypted, so a wallet that has never called `setMode` is
     *      indistinguishable on-chain from one that explicitly chose Lucky — which matters,
     *      because otherwise "has never set a mode" would be a public signal.
     */
    function _ensureRegistered(address account) internal {
        if (_participantSlot[account] != 0) return;

        uint256 count = _participants.length;
        if (count >= participantCap) revert SableErrors.ParticipantCapReached(participantCap);

        _participants.push(account);
        _participantSlot[account] = count + 1;

        SableTypes.Position storage position = _accounts[account];
        position.balance = _zero();
        position.reward = _zero();
        /*
         * New savers start in **Lucky**.
         *
         * Depositing puts you in the prize pool; Steady is the thing you opt out to. The
         * reverse — which this began as — meant a saver could deposit, wait, and never be in a
         * draw at all, because the choice they had not made defaulted them out of it. It also
         * left the pool empty unless somebody went looking for a setting.
         *
         * The confidentiality argument runs the same way round either way: what matters is
         * that the bit is encrypted, not which way it points. But an opt-*out* is the better
         * default for a prize-savings protocol, and "everyone is in the draw unless they
         * privately choose not to be" is a stronger promise than its inverse.
         */
        position.isLucky = FHE.asEbool(true);

        _persist(position.balance, account);
        _persist(position.reward, account);
        _persistBool(position.isLucky, account);

        userYieldIndex[account] = yieldIndex;
        lastCheckpointAt[account] = uint64(block.timestamp);

        emit ParticipantRegistered(account, uint32(count));
    }

    // -------------------------------------------------------------------------
    // Internal: yield index
    // -------------------------------------------------------------------------

    /**
     * @dev Pulls the latest public index from the adapter and draws the matching yield.
     *
     *      Called at the start of every state-changing user operation, so that within a
     *      transaction every account accrues against the same index. The draw is sized on
     *      the encrypted **aggregate** (`_totalDeposits * delta / INDEX_SCALE`), which is a
     *      single scalar multiply — no per-account adapter call, and no way to infer any
     *      individual position from the adapter's activity.
     */
    function _accrueYieldIndex() internal {
        ISableYieldAdapter adapter = yieldAdapter;
        uint64 next = adapter.refreshYieldIndex();
        uint64 current = yieldIndex;

        if (next <= current) return;
        if (next > SableMath.MAX_YIELD_INDEX) {
            revert SableErrors.YieldIndexCeilingExceeded(next, SableMath.MAX_YIELD_INDEX);
        }

        uint64 delta = next - current;

        if (FHE.isInitialized(_totalDeposits)) {
            euint64 owed = FHE.div(FHE.mul(_totalDeposits, delta), SableMath.INDEX_SCALE);
            FHE.allowTransient(owed, address(adapter));
            adapter.drawYield(owed);
        }

        yieldIndex = next;
    }

    // -------------------------------------------------------------------------
    // Internal: checkpointing
    // -------------------------------------------------------------------------

    /**
     * @dev Brings an account's weight and yield up to the present instant.
     *
     *      **This must run before any mutation of the account's balance or mode**, because
     *      both accruals are integrals over the interval that just ended and both must be
     *      evaluated against the values that were in force *during* that interval.
     *      Checkpointing afterwards would retroactively re-price history — which is exactly
     *      the draw-sniping vector the time-weighting is there to close.
     *
     *      Order within the checkpoint is weight first, then yield, so an interval's weight
     *      is computed on the balance the account actually held throughout it rather than
     *      on a balance that already includes that interval's interest.
     */
    function _checkpoint(address account) internal {
        SableTypes.Position storage position = _accounts[account];

        _accrueWeight(account, position);
        _accrueYield(account, position);

        lastCheckpointAt[account] = uint64(block.timestamp);
    }

    /**
     * @dev Accrues `balance * elapsed` into the active round, gated by the encrypted mode.
     *
     *      The gating is the whole trick:
     *
     *      ```
     *      roundWeight += FHE.select(isLucky, balance * elapsedUnits, 0)
     *      ```
     *
     *      Weight accrues only across intervals during which the account was actually in
     *      Lucky mode. Because `setMode` checkpoints *before* flipping the bit, switching
     *      to Lucky never back-dates Steady time into eligibility, and switching to Steady
     *      never claws back eligibility already earned. Neither branch is observable: the
     *      same `select` executes either way.
     */
    function _accrueWeight(address account, SableTypes.Position storage position) private {
        uint256 roundId = activeRoundId;
        if (roundId == 0) return;

        SableTypes.RoundState_ storage round = _roundState[roundId];
        if (round.openedAt == 0) return;

        // Window end is the close time once the round has closed, so a checkpoint that
        // lands during settlement contributes nothing further to a frozen round.
        uint64 windowEnd = round.closedAt == 0 ? uint64(block.timestamp) : round.closedAt;
        uint64 last = lastCheckpointAt[account];
        uint64 windowStart = last > round.openedAt ? last : round.openedAt;

        uint64 units = SableMath.elapsedUnits(windowStart, windowEnd);
        if (units == 0) return;

        euint64 delta = FHE.mul(position.balance, units);
        euint64 gated = FHE.select(position.isLucky, delta, _zero());

        euint64 updated = _accumulate(_roundWeight[roundId][account], gated);
        _roundWeight[roundId][account] = updated;
        _persist(updated, account);
    }

    /**
     * @dev Credits index-based yield, routing it by the encrypted mode.
     *
     *      ```
     *      yield  = balance * (index - userIndex) / INDEX_SCALE
     *      steady = FHE.select(isLucky, 0, yield)   -> compounds into balance
     *      lucky  = FHE.select(isLucky, yield, 0)   -> funds the prize pool
     *      ```
     *
     *      Both branches always execute, so the routing reveals nothing. Note the
     *      structural consequence for **Invariant 1**: the prize pool can only ever be fed
     *      from the `lucky` branch, whose value is bounded above by this interval's
     *      interest. There is no expression anywhere in this contract that moves principal
     *      into the pool.
     */
    function _accrueYield(address account, SableTypes.Position storage position) private {
        uint64 index = yieldIndex;
        uint64 accountIndex = userYieldIndex[account];
        if (index <= accountIndex) return;

        uint64 delta = index - accountIndex;
        euint64 earned = FHE.div(FHE.mul(position.balance, delta), SableMath.INDEX_SCALE);

        euint64 steady = FHE.select(position.isLucky, _zero(), earned);
        euint64 lucky = FHE.select(position.isLucky, earned, _zero());

        position.balance = FHE.add(position.balance, steady);
        _persist(position.balance, account);

        _totalDeposits = _accumulate(_totalDeposits, steady);
        FHE.allowThis(_totalDeposits);

        _routeLuckyYield(lucky);

        userYieldIndex[account] = index;
    }

    /**
     * @dev Sends Lucky-attributed yield to the round that earned it, or parks it.
     *
     *      The accepting window is `OPEN` **and** `CLOSING`, and the `CLOSING` half is not
     *      an edge case — it is the common path. Most of a round's yield is booked by the
     *      final checkpoint that `processEligibilityBatch` performs *after* the round has
     *      closed, so a window of `OPEN` alone would divert almost the entire pool into the
     *      next round and leave every round funded only by mid-round interactions.
     *
     *      `CLOSING` is still safe because prize amounts are not derived until
     *      `finalizeRound`, which cannot run until eligibility is complete. Once the round
     *      is `FINALIZED` its pool is fixed, and later yield parks in `_carryPool` for the
     *      next round rather than silently invalidating already-published prize figures.
     */
    function _routeLuckyYield(euint64 lucky) private {
        uint256 roundId = activeRoundId;
        SableTypes.RoundState state = roundId == 0
            ? SableTypes.RoundState.NONE
            : _roundState[roundId].state;

        if (state == SableTypes.RoundState.OPEN || state == SableTypes.RoundState.CLOSING) {
            euint64 pool = _accumulate(_roundCiphers[roundId].prizePool, lucky);
            _roundCiphers[roundId].prizePool = pool;
            FHE.allowThis(pool);
        } else {
            euint64 carry = _accumulate(_carryPool, lucky);
            _carryPool = carry;
            FHE.allowThis(carry);
        }
    }
}
