// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/**
 * @title  SableMath
 * @notice Pure helpers for Sable's plaintext arithmetic.
 * @dev    Everything here operates on *public* values. No function in this library ever
 *         touches a ciphertext, which is what makes it safe to reason about with ordinary
 *         Solidity overflow rules.
 */
library SableMath {
    /// @notice Basis-point denominator.
    uint16 internal constant BPS_DENOMINATOR = 10_000;

    /**
     * @notice Fixed-point scale for the public yield index.
     * @dev    An index of `1 * INDEX_SCALE` means "no yield accrued yet". The scale is
     *         deliberately modest (1e6, not 1e18): the index is multiplied by an encrypted
     *         balance, and `euint64` arithmetic wraps silently on overflow instead of
     *         reverting. See `docs/FHE_SECURITY.md` for the full overflow budget.
     */
    uint64 internal constant INDEX_SCALE = 1e6;

    /**
     * @notice Hard ceiling on the yield index: five times the starting index.
     * @dev    Bounds `balance * (index - userIndex)` so it cannot approach `2^63`.
     *         With `MAX_CONFIDENTIAL_BALANCE = 1e12` the worst case product is
     *         `1e12 * 4e6 = 4e18`, comfortably inside `euint64`.
     */
    uint64 internal constant MAX_YIELD_INDEX = 5 * INDEX_SCALE;

    /**
     * @notice Largest balance a single account may hold, in the token's smallest unit.
     * @dev    With 6-decimal test USD this is 1,000,000 tokens. Enforced homomorphically
     *         at deposit time, so it is an invariant rather than a hope.
     */
    uint64 internal constant MAX_CONFIDENTIAL_BALANCE = 1e12;

    /**
     * @notice Granularity of time-weighting, in seconds.
     * @dev    Weight accrues as `balance * (elapsed / WEIGHT_TIME_UNIT)`. One minute keeps
     *         the multiplier small enough that a maximal balance held for a maximal round
     *         stays far inside `euint64`.
     */
    uint64 internal constant WEIGHT_TIME_UNIT = 60;

    /**
     * @notice Longest permitted round, in seconds (30 days).
     * @dev    Worst-case weight is `MAX_CONFIDENTIAL_BALANCE * (MAX_ROUND_DURATION / WEIGHT_TIME_UNIT)`
     *         = `1e12 * 43_200` = `4.32e16`, roughly 0.5% of the `euint64` range.
     */
    uint64 internal constant MAX_ROUND_DURATION = 30 days;

    /// @notice Smallest permitted round, in seconds. Guards against degenerate windows.
    uint64 internal constant MIN_ROUND_DURATION = 5 minutes;

    /// @notice Bounds on the ticket-domain exponent `k` in `2^k`.
    uint8 internal constant MIN_TICKET_BITS = 8;
    uint8 internal constant MAX_TICKET_BITS = 32;

    /// @notice Upper bound on draw points per round, to keep settlement batching bounded.
    uint256 internal constant MAX_DRAW_POINTS = 64;

    /**
     * @notice Returns `2^bits` as a `uint64`.
     * @dev    Callers must have validated `bits` against {MIN_TICKET_BITS}/{MAX_TICKET_BITS}.
     */
    function ticketDomain(uint8 bits) internal pure returns (uint64) {
        return uint64(1) << bits;
    }

    /**
     * @notice Largest number of tickets any one participant may hold.
     * @dev    Chosen so that `maxParticipants * maxTicketsPerParticipant <= 2^bits`, which
     *         is what guarantees allocated ticket ranges can never exceed the domain and
     *         therefore never collide. Floor division is deliberate: the remainder simply
     *         stays unallocated and feeds the rollover mechanic.
     */
    function maxTicketsPerParticipant(uint8 bits, uint32 maxParticipants) internal pure returns (uint64) {
        return ticketDomain(bits) / uint64(maxParticipants);
    }

    /**
     * @notice Applies a basis-point share to a plaintext amount.
     */
    function applyBps(uint64 amount, uint16 bps) internal pure returns (uint64) {
        return uint64((uint256(amount) * bps) / BPS_DENOMINATOR);
    }

    /**
     * @notice Number of whole weight-time units between two timestamps.
     * @dev    Returns 0 when `to <= from`, so callers never need to guard the ordering.
     */
    function elapsedUnits(uint64 from, uint64 to) internal pure returns (uint64) {
        if (to <= from) return 0;
        return (to - from) / WEIGHT_TIME_UNIT;
    }

    /**
     * @notice Clamps `value` into the inclusive range `[lo, hi]`.
     */
    function clamp(uint64 value, uint64 lo, uint64 hi) internal pure returns (uint64) {
        if (value < lo) return lo;
        if (value > hi) return hi;
        return value;
    }
}
