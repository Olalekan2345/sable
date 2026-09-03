// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {SableVault} from "./SableVault.sol";
import {ISableYieldAdapter} from "../interfaces/ISableYieldAdapter.sol";
import {SableErrors} from "../libraries/SableErrors.sol";
import {SableMath} from "../libraries/SableMath.sol";
import {SableTypes} from "../libraries/SableTypes.sol";

/**
 * @title  SablePrizeEngine
 * @notice Round lifecycle, confidential ticket allocation, encrypted draws and settlement.
 *
 * @dev    ## The ticket domain, and why it is a power of two
 *
 *         `FHE.randEuint64(upperBound)` requires `upperBound` to be a power of two. That is
 *         a property of the library, not a stylistic choice, and it propagates all the way
 *         up into the product: Sable allocates tickets inside a fixed `2^k` space rather
 *         than minting one ticket per unit of weight.
 *
 *         ```
 *         0 ─────────────────────────────────────────────────────── 2^k
 *         │ alice  │ bob │ carol │            unallocated            │
 *         ```
 *
 *         Allocation is bounded by construction: each participant receives at most
 *         `2^k / maxParticipants` tickets, so the sum can never exceed the domain and
 *         ranges can never overlap. Whatever is left over stays dark — and a random point
 *         landing there is the **rollover**. The rollover is therefore not an error path
 *         bolted on afterwards; it is the direct, unavoidable consequence of a fixed
 *         random domain, surfaced honestly as a product feature.
 *
 *         ## Why everything is batched
 *
 *         Homomorphic operations are metered in HCU and a single transaction has a finite
 *         budget. Settling one participant against one draw point costs two comparisons, a
 *         boolean AND, a select and an add. With 14 draw points that is ~70 operations per
 *         participant, so an unbounded loop over participants would be unschedulable long
 *         before it was merely expensive. Every phase therefore advances an explicit cursor
 *         and can be resumed across transactions, and each cursor is compared against a
 *         `participantCount` **snapshotted at close** so that accounts registering mid
 *         settlement cannot shift indices under a running batch.
 */
/**
 * @dev ## Who may advance a round
 *
 *      Configuration is an administrative act: {configureRound} sets the window, the tier
 *      shares and the ticket domain, and stays behind `ADMIN_ROLE`.
 *
 *      **Everything after it is permissionless.** Opening, closing, eligibility, ticketing,
 *      drawing, settlement and completion may be called by anyone.
 *
 *      That is a deliberate reversal of the usual instinct, and it makes the protocol
 *      *stronger* rather than weaker. Each step is gated by something a caller cannot
 *      influence — a timestamp, a state, or a cursor — so there is no ordering to game and no
 *      moment to choose. `closeRound` reverts before `closesAt`. `drawBatch` draws from
 *      `FHE.randEuint64`, which the sender can neither steer nor read; submitting the
 *      transaction reveals nothing to whoever submits it. A griefer's only option is to pay
 *      gas to advance a round that was going to advance anyway.
 *
 *      What it buys is the removal of a single point of failure. Under an operator role, a
 *      keeper that stops running means prizes stop being awarded until someone with the key
 *      comes back — savers with money in the pool waiting on an operator's uptime. Now any
 *      participant can push a stalled round to completion themselves, and the keeper is a
 *      convenience rather than a dependency.
 */
abstract contract SablePrizeEngine is SableVault {
    // -------------------------------------------------------------------------
    // Events — public round mechanics
    // -------------------------------------------------------------------------
    //
    // Round-level data is public on purpose. This is the half of Sable that should be
    // verifiable by anyone: when the round ran, how it was parameterised, which
    // transaction drew the numbers. None of it references a participant.

    event RoundConfigured(uint256 indexed roundId, uint64 opensAt, uint64 closesAt, uint8 ticketBits);
    event RoundOpened(uint256 indexed roundId, uint64 at);
    event RoundClosed(uint256 indexed roundId, uint64 at, uint32 participantCount);
    event EligibilityAdvanced(uint256 indexed roundId, uint32 cursor, uint32 total);
    event RoundFinalized(uint256 indexed roundId, uint32 drawPointCount);
    event TicketsAdvanced(uint256 indexed roundId, uint32 cursor, uint32 total);
    event DrawAdvanced(uint256 indexed roundId, uint32 cursor, uint32 total);
    event SettlementAdvanced(uint256 indexed roundId, uint64 cursor, uint64 total);
    event RoundCompleted(uint256 indexed roundId, uint64 at);

    /**
     * @notice Publishes the ciphertext handles a client needs in order to public-decrypt
     *         this round's aggregate figures.
     * @dev    These are *handles*, not values. They have been marked publicly decryptable,
     *         so anyone can resolve them through the relayer without a wallet — which is
     *         what lets `/draws` show real prize numbers instead of redacted boxes.
     */
    event RoundAggregatesPublished(
        uint256 indexed roundId,
        bytes32 prizePool,
        bytes32 jackpotPrize,
        bytes32 midPrize,
        bytes32 smallPrize
    );

    /// @notice Publishes the handles describing the jackpot outcome.
    event RoundOutcomePublished(uint256 indexed roundId, bytes32 jackpotHit, bytes32 rollover);

    /// @notice The round's draw points became publicly decryptable.
    event RoundDrawPointsPublished(uint256 indexed roundId, uint32 count);

    constructor(
        IERC7984 asset_,
        ISableYieldAdapter adapter,
        address admin,
        uint32 cap
    ) SableVault(asset_, adapter, admin, cap) {}

    // -------------------------------------------------------------------------
    // Configuration
    // -------------------------------------------------------------------------

    /**
     * @notice Configures the next round.
     * @dev    Validation here is what upholds **Invariant 5** (no round can distribute more
     *         than it holds) and the non-overlapping-ticket property. Both are enforced at
     *         configuration time, in plaintext, where they can actually revert — neither
     *         could be checked later against ciphertext.
     */
    function configureRound(SableTypes.RoundConfig calldata config)
        external
        onlyRole(ADMIN_ROLE)
        returns (uint256 roundId)
    {
        _validateConfig(config);

        roundId = ++roundCount;
        _roundConfig[roundId] = config;
        _roundState[roundId].state = SableTypes.RoundState.SCHEDULED;

        emit RoundConfigured(roundId, config.opensAt, config.closesAt, config.ticketBits);
    }

    function _validateConfig(SableTypes.RoundConfig calldata config) private pure {
        if (config.closesAt <= config.opensAt) {
            revert SableErrors.InvalidRoundWindow(config.opensAt, config.closesAt);
        }

        uint64 duration = config.closesAt - config.opensAt;
        if (duration > SableMath.MAX_ROUND_DURATION || duration < SableMath.MIN_ROUND_DURATION) {
            revert SableErrors.RoundTooLong(duration, SableMath.MAX_ROUND_DURATION);
        }

        if (config.ticketBits < SableMath.MIN_TICKET_BITS || config.ticketBits > SableMath.MAX_TICKET_BITS) {
            revert SableErrors.InvalidTicketBits(config.ticketBits);
        }

        if (config.weightPerTicket == 0) revert SableErrors.InvalidWeightPerTicket();

        if (config.maxParticipants == 0 || SableMath.ticketDomain(config.ticketBits) < config.maxParticipants) {
            revert SableErrors.InvalidParticipantCap(config.maxParticipants);
        }

        uint256 totalBps = uint256(config.jackpotShareBps) + config.midShareBps + config.smallShareBps;
        if (totalBps > SableMath.BPS_DENOMINATOR) revert SableErrors.InvalidPrizeShares(totalBps);

        // A tier with a share but no winners would silently burn its allocation; a tier
        // with winners but no share would emit meaningless zero-value draws.
        _validateTier(config.jackpotWinnerCount, config.jackpotShareBps);
        _validateTier(config.midWinnerCount, config.midShareBps);
        _validateTier(config.smallWinnerCount, config.smallShareBps);

        uint256 points = uint256(config.jackpotWinnerCount) + config.midWinnerCount + config.smallWinnerCount;
        if (points == 0 || points > SableMath.MAX_DRAW_POINTS) {
            revert SableErrors.TooManyDrawPoints(points, SableMath.MAX_DRAW_POINTS);
        }
    }

    function _validateTier(uint8 winnerCount, uint16 shareBps) private pure {
        if ((winnerCount == 0) != (shareBps == 0)) {
            revert SableErrors.InvalidTierConfig(winnerCount, shareBps);
        }
    }

    // -------------------------------------------------------------------------
    // OPEN
    // -------------------------------------------------------------------------

    /**
     * @notice Opens a scheduled round.
     * @dev    Folds in both carried-over sources of prize funding: yield attributed to
     *         Lucky savers while no round was open, and any jackpot that rolled forward
     *         from the previous round.
     */
    function openRound(uint256 roundId) external whenNotPaused {
        _requireState(roundId, SableTypes.RoundState.SCHEDULED);
        if (activeRoundId != 0) revert SableErrors.RoundAlreadyOpen(activeRoundId);

        SableTypes.RoundConfig storage config = _roundConfig[roundId];
        if (block.timestamp < config.opensAt) {
            revert SableErrors.InvalidRoundWindow(config.opensAt, config.closesAt);
        }

        _accrueYieldIndex();

        SableTypes.RoundState_ storage round = _roundState[roundId];
        round.state = SableTypes.RoundState.OPEN;
        round.openedAt = uint64(block.timestamp);
        activeRoundId = roundId;

        euint64 pool = _roundCiphers[roundId].prizePool;

        if (FHE.isInitialized(_carryPool)) {
            pool = _accumulate(pool, _carryPool);
            _carryPool = _zero();
            FHE.allowThis(_carryPool);
        }

        if (roundId > 1) {
            euint64 rollover = _roundCiphers[roundId - 1].rollover;
            if (FHE.isInitialized(rollover)) {
                pool = _accumulate(pool, rollover);
            }
        }

        if (FHE.isInitialized(pool)) {
            _roundCiphers[roundId].prizePool = pool;
            FHE.allowThis(pool);
        }

        emit RoundOpened(roundId, round.openedAt);
    }

    // -------------------------------------------------------------------------
    // CLOSE
    // -------------------------------------------------------------------------

    /**
     * @notice Closes an open round and freezes its participant set.
     * @dev    `participantCount` is snapshotted here. Every cursor for the rest of the
     *         pipeline is measured against this snapshot, so accounts that register during
     *         settlement are simply outside the round rather than able to disturb it.
     */
    function closeRound(uint256 roundId) external {
        _requireState(roundId, SableTypes.RoundState.OPEN);

        SableTypes.RoundConfig storage config = _roundConfig[roundId];
        if (block.timestamp < config.closesAt) {
            revert SableErrors.RoundNotClosable(roundId, config.closesAt, uint64(block.timestamp));
        }

        _accrueYieldIndex();

        SableTypes.RoundState_ storage round = _roundState[roundId];
        round.state = SableTypes.RoundState.CLOSING;
        round.closedAt = uint64(block.timestamp);

        uint256 registered = _participants.length;
        uint32 cap = config.maxParticipants;
        round.participantCount = registered > cap ? cap : uint32(registered);

        emit RoundClosed(roundId, round.closedAt, round.participantCount);
    }

    /**
     * @notice Gives each participant their final checkpoint for the round.
     * @dev    Savers who never transacted during the round still earned weight, so the
     *         round cannot be scored until every registered account has been walked
     *         forward to the close time. Accounts that already checkpointed after the
     *         close simply accrue zero more — the window arithmetic makes this idempotent
     *         rather than requiring a per-account "already processed" flag.
     */
    function processEligibilityBatch(uint256 roundId, uint32 maxSteps) external {
        _requireState(roundId, SableTypes.RoundState.CLOSING);
        if (maxSteps == 0) revert SableErrors.EmptyBatch();

        SableTypes.RoundState_ storage round = _roundState[roundId];
        uint32 total = round.participantCount;
        uint32 cursor = round.eligibilityCursor;
        if (cursor >= total) revert SableErrors.BatchAlreadyComplete(roundId);

        uint32 end = cursor + maxSteps;
        if (end > total) end = total;

        for (uint32 i = cursor; i < end; ++i) {
            _checkpoint(_participants[i]);
        }

        round.eligibilityCursor = end;
        emit EligibilityAdvanced(roundId, end, total);
    }

    // -------------------------------------------------------------------------
    // FINALIZE
    // -------------------------------------------------------------------------

    /**
     * @notice Derives prize amounts from the pool and publishes the public aggregates.
     *
     * @dev    Tier amounts are computed homomorphically from the encrypted pool using
     *         *public* shares, then marked publicly decryptable together with the pool
     *         itself. This is the one place Sable deliberately reveals a number, and the
     *         reasoning is worth stating: the pool is an **aggregate over all Lucky
     *         savers**, so publishing it exposes no individual position, while keeping it
     *         secret would force `/draws` to show redacted boxes where a real prize belongs
     *         — and a prize nobody can see is not a prize anyone can trust.
     *
     *         Floor division at every step is what makes **Invariant 5** hold:
     *         `jackpot*jCount + mid*mCount + small*sCount <= pool`, always.
     */
    function finalizeRound(uint256 roundId) external {
        _requireState(roundId, SableTypes.RoundState.CLOSING);

        SableTypes.RoundState_ storage round = _roundState[roundId];
        if (round.eligibilityCursor < round.participantCount) {
            revert SableErrors.BatchIncomplete(roundId, round.eligibilityCursor, round.participantCount);
        }

        SableTypes.RoundConfig storage config = _roundConfig[roundId];
        SableTypes.RoundCiphertexts storage ciphers = _roundCiphers[roundId];

        euint64 pool = FHE.isInitialized(ciphers.prizePool) ? ciphers.prizePool : _zero();
        ciphers.prizePool = pool;

        ciphers.jackpotPrize = _tierPrize(pool, config.jackpotShareBps, config.jackpotWinnerCount);
        ciphers.midPrize = _tierPrize(pool, config.midShareBps, config.midWinnerCount);
        ciphers.smallPrize = _tierPrize(pool, config.smallShareBps, config.smallWinnerCount);

        FHE.allowThis(pool);
        FHE.allowThis(ciphers.jackpotPrize);
        FHE.allowThis(ciphers.midPrize);
        FHE.allowThis(ciphers.smallPrize);

        FHE.makePubliclyDecryptable(pool);
        FHE.makePubliclyDecryptable(ciphers.jackpotPrize);
        FHE.makePubliclyDecryptable(ciphers.midPrize);
        FHE.makePubliclyDecryptable(ciphers.smallPrize);

        _buildDrawSchedule(roundId, config, round);

        // A round nobody joined has no ticket ranges to assign, and `assignTicketsBatch`
        // would revert `BatchAlreadyComplete` on an empty set — leaving the round stuck in
        // FINALIZED with no legal transition out. Skip the ticket phase entirely so an
        // unattended round can still complete and roll its pool forward.
        //
        // This is not hypothetical: the first round of any deployment is opened before
        // anyone has deposited.
        round.state = round.participantCount == 0
            ? SableTypes.RoundState.DRAWING
            : SableTypes.RoundState.FINALIZED;

        emit RoundAggregatesPublished(
            roundId,
            euint64.unwrap(pool),
            euint64.unwrap(ciphers.jackpotPrize),
            euint64.unwrap(ciphers.midPrize),
            euint64.unwrap(ciphers.smallPrize)
        );
        emit RoundFinalized(roundId, round.drawPointCount);
    }

    /// @dev `pool * shareBps / 10_000 / winnerCount`, or encrypted zero for an unused tier.
    function _tierPrize(euint64 pool, uint16 shareBps, uint8 winnerCount) private returns (euint64) {
        if (winnerCount == 0 || shareBps == 0) return _zero();
        euint64 tierTotal = FHE.div(FHE.mul(pool, uint64(shareBps)), uint64(SableMath.BPS_DENOMINATOR));
        return FHE.div(tierTotal, uint64(winnerCount));
    }

    /// @dev Lays out draw points as jackpot first, then mid, then small.
    function _buildDrawSchedule(
        uint256 roundId,
        SableTypes.RoundConfig storage config,
        SableTypes.RoundState_ storage round
    ) private {
        SableTypes.Tier[] storage tiers = _drawTiers[roundId];

        for (uint8 i = 0; i < config.jackpotWinnerCount; ++i) tiers.push(SableTypes.Tier.JACKPOT);
        for (uint8 i = 0; i < config.midWinnerCount; ++i) tiers.push(SableTypes.Tier.MID);
        for (uint8 i = 0; i < config.smallWinnerCount; ++i) tiers.push(SableTypes.Tier.SMALL);

        round.drawPointCount = uint32(tiers.length);
    }

    // -------------------------------------------------------------------------
    // TICKETS
    // -------------------------------------------------------------------------

    /**
     * @notice Assigns each participant a confidential, non-overlapping ticket range.
     *
     * @dev    ```
     *         tickets = min(weight / weightPerTicket, 2^k / maxParticipants)
     *         [start, end) = [cumulative, cumulative + tickets)
     *         ```
     *
     *         The per-participant cap is not a rounding detail — it is what bounds the sum
     *         below `2^k` without ever comparing an encrypted total against a public one.
     *         It also gives the product an anti-whale property worth having in a savings
     *         context: past the cap, more capital stops buying more odds.
     *
     *         A participant with no eligible weight receives an empty range
     *         (`start == end`), which no random point can ever fall inside. Steady savers
     *         are handled entirely by that identity — there is no branch on mode here,
     *         because their weight was already zeroed by the `select` in `_accrueWeight`.
     */
    function assignTicketsBatch(uint256 roundId, uint32 maxSteps) external {
        _requireState(roundId, SableTypes.RoundState.FINALIZED);
        if (maxSteps == 0) revert SableErrors.EmptyBatch();

        SableTypes.RoundState_ storage round = _roundState[roundId];
        uint32 total = round.participantCount;
        uint32 cursor = round.ticketCursor;
        if (cursor >= total) revert SableErrors.BatchAlreadyComplete(roundId);

        uint32 end = cursor + maxSteps;
        if (end > total) end = total;

        euint64 cumulative = FHE.isInitialized(_roundCiphers[roundId].totalTickets)
            ? _roundCiphers[roundId].totalTickets
            : _zero();

        for (uint32 i = cursor; i < end; ++i) {
            cumulative = _assignTicketRange(roundId, _participants[i], cumulative);
        }

        _roundCiphers[roundId].totalTickets = cumulative;
        FHE.allowThis(cumulative);

        round.ticketCursor = end;
        if (end == total) {
            round.state = SableTypes.RoundState.DRAWING;
        }

        emit TicketsAdvanced(roundId, end, total);
    }

    /**
     * @dev Assigns one participant the range `[cumulative, cumulative + tickets)` and
     *      returns the new cumulative boundary.
     *
     *      Split out of {assignTicketsBatch} to keep that function under the EVM's
     *      stack-slot ceiling — FHE handles are full stack words and the batch loop needs
     *      several of them live at once.
     */
    function _assignTicketRange(uint256 roundId, address account, euint64 cumulative)
        private
        returns (euint64)
    {
        SableTypes.RoundConfig storage config = _roundConfig[roundId];
        euint64 weight = _roundWeight[roundId][account];

        euint64 tickets = FHE.isInitialized(weight)
            ? FHE.min(
                FHE.div(weight, config.weightPerTicket),
                SableMath.maxTicketsPerParticipant(config.ticketBits, config.maxParticipants)
            )
            : _zero();

        euint64 rangeEnd = FHE.add(cumulative, tickets);

        _ticketStart[roundId][account] = cumulative;
        _ticketEnd[roundId][account] = rangeEnd;

        // The account may read its own range; nobody else can, and the contract needs both
        // handles again during settlement.
        _persist(cumulative, account);
        _persist(rangeEnd, account);

        return rangeEnd;
    }

    // -------------------------------------------------------------------------
    // DRAW
    // -------------------------------------------------------------------------

    /**
     * @notice Generates encrypted random draw points.
     *
     * @dev    The randomness comes from `FHE.randEuint64(2^k)` inside a transaction. It is
     *         never derived from `block.timestamp`, `blockhash`, `prevrandao`, an off-chain
     *         service, or anything a caller can observe or steer — and because it is a
     *         ciphertext, the operator who submits this transaction cannot read the number
     *         they just drew any more than anyone else can.
     *
     *         Draw points are independent. A saver holding a wide range can therefore win
     *         more than one prize in a round; that is intended, and it is the same property
     *         a physical multi-prize draw has.
     */
    function drawBatch(uint256 roundId, uint32 maxSteps) external {
        _requireState(roundId, SableTypes.RoundState.DRAWING);
        if (maxSteps == 0) revert SableErrors.EmptyBatch();

        SableTypes.RoundState_ storage round = _roundState[roundId];
        uint32 total = round.drawPointCount;
        uint32 cursor = round.drawCursor;
        if (cursor >= total) revert SableErrors.BatchAlreadyComplete(roundId);

        uint64 domain = SableMath.ticketDomain(_roundConfig[roundId].ticketBits);

        uint32 end = cursor + maxSteps;
        if (end > total) end = total;

        euint64[] storage points = _drawPoints[roundId];
        for (uint32 i = cursor; i < end; ++i) {
            euint64 point = FHE.randEuint64(domain);
            FHE.allowThis(point);
            points.push(point);
        }

        round.drawCursor = end;
        if (end == total) {
            round.state = SableTypes.RoundState.SETTLING;
        }

        emit DrawAdvanced(roundId, end, total);
    }

    // -------------------------------------------------------------------------
    // SETTLE
    // -------------------------------------------------------------------------

    /**
     * @notice Settles a batch of participants against every draw point.
     *
     * @dev    For each `(participant, point)` pair:
     *
     *         ```
     *         isWinner = (point >= start) AND (point < end)
     *         reward  += FHE.select(isWinner, tierPrize, 0)
     *         ```
     *
     *         **Every participant is evaluated against every point, and every participant
     *         receives an encrypted result.** Losers are credited an encrypted zero, not
     *         skipped. That symmetry is the point: there is no winners list, no event
     *         naming an address, no branch whose gas cost differs between winning and
     *         losing. A wallet learns whether it won by decrypting its own reward handle,
     *         and nobody else can learn it at all.
     *
     *         The cursor is participant-granular so the reward handle is persisted once per
     *         participant rather than once per pair — ACL grants are storage writes in the
     *         ACL contract, and doing 14 of them per account would dominate the cost.
     */
    function settleBatch(uint256 roundId, uint32 maxParticipants) external {
        _requireState(roundId, SableTypes.RoundState.SETTLING);
        if (maxParticipants == 0) revert SableErrors.EmptyBatch();

        SableTypes.RoundState_ storage round = _roundState[roundId];
        uint64 total = round.participantCount;
        uint64 cursor = round.settleCursor;
        if (cursor >= total) revert SableErrors.BatchAlreadyComplete(roundId);

        uint64 end = cursor + maxParticipants;
        if (end > total) end = total;

        for (uint64 i = cursor; i < end; ++i) {
            _settleParticipant(roundId, _participants[uint32(i)]);
        }

        round.settleCursor = end;
        emit SettlementAdvanced(roundId, end, total);
    }

    /**
     * @dev Evaluates one participant against every draw point of the round.
     *
     *      Extracted from {settleBatch} for the same stack-depth reason as
     *      {_assignTicketRange}. Keeping the whole per-account evaluation in one call also
     *      means the reward handle is written and re-permissioned exactly once per account
     *      per batch, rather than once per draw point.
     */
    function _settleParticipant(uint256 roundId, address account) private {
        euint64 start = _ticketStart[roundId][account];
        euint64 stop = _ticketEnd[roundId][account];

        // Never assigned a range (registered after the close snapshot): nothing to do.
        if (!FHE.isInitialized(start) || !FHE.isInitialized(stop)) return;

        euint64[] storage points = _drawPoints[roundId];
        SableTypes.Tier[] storage tiers = _drawTiers[roundId];

        euint64 reward = _accounts[account].reward;
        uint256 pointCount = points.length;

        for (uint256 p = 0; p < pointCount; ++p) {
            ebool isWinner = FHE.and(FHE.ge(points[p], start), FHE.lt(points[p], stop));
            reward = FHE.add(
                reward,
                FHE.select(isWinner, _prizeForTier(_roundCiphers[roundId], tiers[p]), _zero())
            );
        }

        _accounts[account].reward = reward;
        _persist(reward, account);
    }

    function _prizeForTier(SableTypes.RoundCiphertexts storage ciphers, SableTypes.Tier tier)
        private
        view
        returns (euint64)
    {
        if (tier == SableTypes.Tier.JACKPOT) return ciphers.jackpotPrize;
        if (tier == SableTypes.Tier.MID) return ciphers.midPrize;
        return ciphers.smallPrize;
    }

    // -------------------------------------------------------------------------
    // COMPLETE
    // -------------------------------------------------------------------------

    /**
     * @notice Finalises the round and resolves the jackpot rollover.
     *
     * @dev    A jackpot point that landed outside every allocated range matched nobody, so
     *         its share was never credited to anyone and is still sitting in the vault.
     *         Rather than let it stagnate, it is carried into the next round's pool:
     *
     *         ```
     *         hit      = point < totalTickets          // allocation is contiguous from 0
     *         rollover = FHE.select(hit, 0, jackpotPrize)
     *         ```
     *
     *         Both the hit bit and the rollover amount are published as publicly
     *         decryptable aggregates so `/draws` can state plainly what happened. The
     *         disclosure is one bit about *aggregate* ticket allocation and reveals nothing
     *         about any participant — notably, it does not reveal who won when the jackpot
     *         *was* claimed.
     */
    function completeRound(uint256 roundId) external {
        _requireState(roundId, SableTypes.RoundState.SETTLING);

        SableTypes.RoundState_ storage round = _roundState[roundId];
        if (round.settleCursor < round.participantCount) {
            revert SableErrors.BatchIncomplete(roundId, round.settleCursor, round.participantCount);
        }

        SableTypes.RoundCiphertexts storage ciphers = _roundCiphers[roundId];
        SableTypes.RoundConfig storage config = _roundConfig[roundId];

        euint64 totalTickets = FHE.isInitialized(ciphers.totalTickets) ? ciphers.totalTickets : _zero();
        euint64[] storage points = _drawPoints[roundId];

        euint64 rollover = _zero();
        ebool allHit = FHE.asEbool(true);

        for (uint8 i = 0; i < config.jackpotWinnerCount; ++i) {
            ebool hit = FHE.lt(points[i], totalTickets);
            allHit = FHE.and(allHit, hit);
            rollover = FHE.add(rollover, FHE.select(hit, _zero(), ciphers.jackpotPrize));
        }

        ciphers.rollover = rollover;
        ciphers.jackpotHit = allHit;

        FHE.allowThis(rollover);
        FHE.allowThis(allHit);
        FHE.makePubliclyDecryptable(rollover);
        FHE.makePubliclyDecryptable(allHit);

        /*
         * Publish the numbers that were drawn.
         *
         * Until this moment the draw points are ciphertexts nobody can read — including the
         * operator who submitted the transaction that produced them. Releasing them here, once
         * settlement is finished and no outcome can still be influenced, is what makes the
         * draw auditable rather than merely trustworthy: anyone can now confirm that the
         * points are in range, that there are as many as the configuration called for, and
         * that the rollover bit is consistent with them.
         *
         * Ticket ranges stay encrypted, so this reveals where the darts landed and not whose
         * territory they hit. **What it does leak** is a bound on the total allocated ticket
         * span: `jackpotHit` says whether every jackpot point fell inside it, which combined
         * with the point values brackets the aggregate weight. That is an aggregate over all
         * savers, in the same category as the prize pool this contract already publishes, and
         * it is recorded in the privacy model rather than left for someone to discover.
         *
         * Deliberately not done in `drawBatch`: points published while settlement was still
         * running would let a saver who can read their own range work out their result before
         * the protocol had finished computing it.
         */
        for (uint256 i = 0; i < points.length; ++i) {
            FHE.makePubliclyDecryptable(points[i]);
        }

        round.state = SableTypes.RoundState.COMPLETE;
        round.completedAt = uint64(block.timestamp);
        round.jackpotResolved = true;

        if (activeRoundId == roundId) activeRoundId = 0;

        emit RoundDrawPointsPublished(roundId, uint32(points.length));
        emit RoundOutcomePublished(roundId, ebool.unwrap(allHit), euint64.unwrap(rollover));
        emit RoundCompleted(roundId, round.completedAt);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @notice Public configuration for `roundId`.
    function roundConfig(uint256 roundId) external view returns (SableTypes.RoundConfig memory) {
        return _roundConfig[roundId];
    }

    /// @notice Public lifecycle state for `roundId`.
    function roundState(uint256 roundId) external view returns (SableTypes.RoundState_ memory) {
        return _roundState[roundId];
    }

    /// @notice Publicly decryptable aggregate handles for `roundId`.
    function roundAggregates(uint256 roundId)
        external
        view
        returns (euint64 prizePool, euint64 jackpotPrize, euint64 midPrize, euint64 smallPrize, euint64 rollover)
    {
        SableTypes.RoundCiphertexts storage ciphers = _roundCiphers[roundId];
        return (ciphers.prizePool, ciphers.jackpotPrize, ciphers.midPrize, ciphers.smallPrize, ciphers.rollover);
    }

    /// @notice Publicly decryptable bit: did every jackpot point match an allocated ticket?
    function roundJackpotHit(uint256 roundId) external view returns (ebool) {
        return _roundCiphers[roundId].jackpotHit;
    }

    /// @notice Number of draw points generated so far for `roundId`.
    function drawPointCount(uint256 roundId) external view returns (uint256) {
        return _drawPoints[roundId].length;
    }

    /**
     * @notice The round's draw points.
     * @dev    Readable at any time, but only *decryptable* once {completeRound} has published
     *         them. Before that these are handles to values nobody holds the permission to
     *         read, which is the state the draw needs to be in while it is still being settled.
     */
    function drawPoints(uint256 roundId) external view returns (euint64[] memory) {
        return _drawPoints[roundId];
    }

    /// @notice Confidential ticket range for `account` in `roundId`.
    function confidentialTicketRange(uint256 roundId, address account)
        external
        view
        returns (euint64 start, euint64 end)
    {
        return (_ticketStart[roundId][account], _ticketEnd[roundId][account]);
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _requireState(uint256 roundId, SableTypes.RoundState expected) private view {
        if (roundId == 0 || roundId > roundCount) revert SableErrors.UnknownRound(roundId);
        SableTypes.RoundState actual = _roundState[roundId].state;
        if (actual != expected) {
            revert SableErrors.InvalidRoundState(roundId, uint8(actual), uint8(expected));
        }
    }
}
