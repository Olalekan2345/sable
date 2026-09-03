// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title  SableErrors
 * @notice Every revert reason used by the Sable protocol.
 * @dev    Custom errors only — no revert strings. Error names are deliberately generic
 *         with respect to confidential state: no error may ever encode a user's balance,
 *         mode, weight or reward, because revert data is public. See `docs/FHE_SECURITY.md`.
 */
library SableErrors {
    // ---------------------------------------------------------------------
    // Access control
    // ---------------------------------------------------------------------

    /// @notice Caller does not hold the role required for this action.
    error Unauthorized(address caller, bytes32 role);

    /// @notice The protocol is paused.
    error Paused();

    /// @notice The protocol is not paused.
    error NotPaused();

    /// @notice A zero address was supplied where a live contract is required.
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Round lifecycle
    // ---------------------------------------------------------------------

    /// @notice The round is not in the state this action requires.
    /// @param roundId  Round the action targeted.
    /// @param actual   State the round is currently in.
    /// @param expected State the action requires.
    error InvalidRoundState(uint256 roundId, uint8 actual, uint8 expected);

    /// @notice The referenced round has never been configured.
    error UnknownRound(uint256 roundId);

    /// @notice A round is already open; only one round may be open at a time.
    error RoundAlreadyOpen(uint256 openRoundId);

    /// @notice The round cannot close before its scheduled close time.
    error RoundNotClosable(uint256 roundId, uint64 closesAt, uint64 nowTs);

    /// @notice The round window is malformed (opens >= closes, or duration out of bounds).
    error InvalidRoundWindow(uint64 opensAt, uint64 closesAt);

    /// @notice The round duration exceeds the value that keeps weight accumulation
    ///         inside the `euint64` domain.
    error RoundTooLong(uint64 duration, uint64 maxDuration);

    // ---------------------------------------------------------------------
    // Round configuration
    // ---------------------------------------------------------------------

    /// @notice Prize tier shares must sum to at most 10_000 basis points.
    error InvalidPrizeShares(uint256 totalBps);

    /// @notice A prize tier was configured with a share but no winners, or winners but no share.
    error InvalidTierConfig(uint8 winnerCount, uint16 shareBps);

    /// @notice The ticket domain exponent is outside the supported range.
    error InvalidTicketBits(uint8 ticketBits);

    /// @notice `weightPerTicket` must be non-zero — it is a divisor.
    error InvalidWeightPerTicket();

    /// @notice Participant cap is zero, or too large for the configured ticket domain.
    error InvalidParticipantCap(uint32 cap);

    /// @notice Total draw points for the round exceeds the per-round maximum.
    error TooManyDrawPoints(uint256 count, uint256 max);

    // ---------------------------------------------------------------------
    // Batching
    // ---------------------------------------------------------------------

    /// @notice A batch was submitted with zero steps.
    error EmptyBatch();

    /// @notice The phase this batch belongs to has already processed every item.
    error BatchAlreadyComplete(uint256 roundId);

    /// @notice The phase cannot advance because a previous phase has unprocessed items.
    error BatchIncomplete(uint256 roundId, uint256 processed, uint256 total);

    // ---------------------------------------------------------------------
    // Vault
    // ---------------------------------------------------------------------

    /// @notice The participant registry is full for this deployment.
    error ParticipantCapReached(uint32 cap);

    /// @notice Caller is not a registered participant.
    error NotAParticipant(address account);

    /// @notice The supplied yield index is not strictly increasing, or exceeds the ceiling
    ///         that keeps yield accrual inside the `euint64` domain.
    error InvalidYieldIndex(uint64 current, uint64 next);

    /// @notice The yield adapter reported an index above the hard protocol ceiling.
    error YieldIndexCeilingExceeded(uint64 index, uint64 ceiling);
}
