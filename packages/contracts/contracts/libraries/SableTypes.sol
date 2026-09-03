// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";

/**
 * @title  SableTypes
 * @notice Shared enums and structs for the Sable protocol.
 * @dev    The split between plaintext and ciphertext fields in these structs *is* the
 *         privacy model. Anything declared as a plain integer here is public forever;
 *         anything declared `euint64` / `ebool` is readable only through the FHEVM ACL.
 */
library SableTypes {
    /**
     * @notice Lifecycle of a prize round.
     *
     * ```
     * NONE ─ configure ─▶ SCHEDULED ─ open ─▶ OPEN ─ close ─▶ CLOSING
     *                                                            │ processEligibilityBatch
     *                                                            ▼
     *                                                        FINALIZED
     *                                                            │ assignTicketsBatch
     *                                                            ▼
     *                                                         DRAWING
     *                                                            │ drawBatch  (encrypted RNG)
     *                                                            ▼
     *                                                         SETTLING
     *                                                            │ settleBatch
     *                                                            ▼
     *                                                         COMPLETE
     * ```
     *
     * Every transition is guarded. `OPEN -> COMPLETE` is unreachable.
     */
    enum RoundState {
        NONE,
        SCHEDULED,
        OPEN,
        CLOSING,
        FINALIZED,
        DRAWING,
        SETTLING,
        COMPLETE
    }

    /// @notice Prize tiers, in descending prize size.
    enum Tier {
        JACKPOT,
        MID,
        SMALL
    }

    /**
     * @notice Public, operator-supplied configuration for a round.
     * @dev    All fields are plaintext and intentionally public: round mechanics are the
     *         part of Sable that *should* be verifiable by anyone.
     *
     * @param opensAt            Unix time at which the round may be opened.
     * @param closesAt           Unix time from which the round may be closed.
     * @param ticketBits         `k` in a `2^k` ticket domain. Must be a value for which
     *                           `FHE.randEuint64` accepts the bound (power of two).
     * @param maxParticipants    Upper bound on registered participants for this round.
     * @param weightPerTicket    Divisor turning eligible weight into whole tickets.
     * @param jackpotWinnerCount Number of independent jackpot draw points.
     * @param midWinnerCount     Number of independent mid-tier draw points.
     * @param smallWinnerCount   Number of independent small-tier draw points.
     * @param jackpotShareBps    Share of the prize pool allocated to the jackpot tier.
     * @param midShareBps        Share of the prize pool allocated to the mid tier.
     * @param smallShareBps      Share of the prize pool allocated to the small tier.
     */
    struct RoundConfig {
        uint64 opensAt;
        uint64 closesAt;
        uint8 ticketBits;
        uint32 maxParticipants;
        uint64 weightPerTicket;
        uint8 jackpotWinnerCount;
        uint8 midWinnerCount;
        uint8 smallWinnerCount;
        uint16 jackpotShareBps;
        uint16 midShareBps;
        uint16 smallShareBps;
    }

    /**
     * @notice Public lifecycle bookkeeping for a round.
     * @dev    Deliberately contains no per-participant data.
     *
     * @param state             Current lifecycle state.
     * @param openedAt          Unix time the round actually opened (0 until opened).
     * @param closedAt          Unix time the round actually closed (0 until closed).
     * @param completedAt       Unix time settlement finished (0 until complete).
     * @param participantCount  Participants snapshotted at close.
     * @param drawPointCount    Total draw points for the round.
     * @param eligibilityCursor Participants given their final checkpoint.
     * @param ticketCursor      Participants assigned a ticket range.
     * @param drawCursor        Draw points generated so far.
     * @param settleCursor      `(participant, drawPoint)` pairs settled so far.
     * @param jackpotResolved   True once the jackpot match bit has been published.
     */
    struct RoundState_ {
        RoundState state;
        uint64 openedAt;
        uint64 closedAt;
        uint64 completedAt;
        uint32 participantCount;
        uint32 drawPointCount;
        uint32 eligibilityCursor;
        uint32 ticketCursor;
        uint32 drawCursor;
        uint64 settleCursor;
        bool jackpotResolved;
    }

    /**
     * @notice Confidential per-round accumulators.
     *
     * @param prizePool     Encrypted prize pool: the sum of yield contributed by savers
     *                      who were in Lucky mode, plus any jackpot rolled over.
     * @param jackpotPrize  Encrypted per-winner jackpot amount.
     * @param midPrize      Encrypted per-winner mid-tier amount.
     * @param smallPrize    Encrypted per-winner small-tier amount.
     * @param totalTickets  Encrypted count of allocated tickets in the `2^k` domain.
     * @param rollover      Encrypted amount carried into the next round's pool.
     * @param jackpotHit    Encrypted bit: did the jackpot point land on an allocated
     *                      ticket? Made publicly decryptable so `/draws` can render the
     *                      rollover honestly. Leaks one bit about aggregate allocation
     *                      and nothing about any individual.
     */
    struct RoundCiphertexts {
        euint64 prizePool;
        euint64 jackpotPrize;
        euint64 midPrize;
        euint64 smallPrize;
        euint64 totalTickets;
        euint64 rollover;
        ebool jackpotHit;
    }

    /**
     * @notice A participant's confidential position.
     * @dev    Round-scoped confidential state (weight and ticket range) is deliberately
     *         *not* held here. It lives in `roundId => account => handle` mappings so that
     *         a new round starts from a clean slate without an O(participants) reset, and
     *         so a completed round's allocation stays independently auditable.
     *
     * @param balance  Principal plus compounded Steady yield.
     * @param reward   Prize winnings not yet moved into `balance`.
     * @param isLucky  The confidential mode bit. This is Sable's headline secret.
     */
    struct Position {
        euint64 balance;
        euint64 reward;
        ebool isLucky;
    }
}
