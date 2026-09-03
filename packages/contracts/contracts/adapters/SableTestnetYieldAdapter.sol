// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {ISableYieldAdapter} from "../interfaces/ISableYieldAdapter.sol";
import {SableConfidentialUSD} from "../token/SableConfidentialUSD.sol";
import {SableErrors} from "../libraries/SableErrors.sol";
import {SableMath} from "../libraries/SableMath.sol";

/**
 * @title  SableTestnetYieldAdapter
 * @notice Yield source for the Sable testnet deployment.
 *
 * @dev    ## What this is, stated plainly
 *
 *         Sepolia has no confidential-asset lending market to plug into. Rather than
 *         pretend otherwise, this adapter implements yield the only way that is honest on
 *         a testnet: a **published on-chain rate applied to real elapsed time, settled by
 *         actually issuing tokens**.
 *
 *         It is not a simulation and it is not a number the frontend increments. The index
 *         advances from `block.timestamp`, `drawYield` mints real ERC-7984 units into the
 *         vault, and every figure the app displays traces back to this contract's state.
 *         What it is *not* is external yield: nobody is borrowing these savings and paying
 *         interest on them. The UI, the README and `/how-it-works` all say so in those
 *         words, because a testnet product that misrepresents where its yield comes from
 *         teaches users exactly the wrong instinct.
 *
 *         Swapping in a genuine strategy means implementing {ISableYieldAdapter} against a
 *         real venue and calling `setYieldAdapter`. Nothing in the vault changes: the vault
 *         only ever consumes a public index and a delivery call.
 *
 *         ## Why the index is public
 *
 *         FHEVM has no encrypted-by-encrypted division, so the vault cannot compute one
 *         saver's share of a pooled return homomorphically. Publishing the *rate* and
 *         multiplying each encrypted balance by a public delta is exact, costs a single
 *         scalar multiply, and leaks only a protocol parameter — never a position.
 */
contract SableTestnetYieldAdapter is ISableYieldAdapter, ZamaEthereumConfig {
    /// @notice The confidential asset yield is paid in.
    SableConfidentialUSD public immutable token;

    /// @notice The only address permitted to draw yield.
    address public vault;

    /// @notice Contract owner.
    address public owner;

    /// @inheritdoc ISableYieldAdapter
    uint64 public yieldIndex;

    /// @notice Published annual rate, in basis points (e.g. 500 = 5.00% per year).
    uint64 public ratePerYearBps;

    /// @notice Timestamp the index was last advanced.
    uint64 public lastAccrualAt;

    uint64 private constant SECONDS_PER_YEAR = 365 days;

    /// @notice Caller is not the vault.
    error NotVault(address caller);

    /// @notice Caller is not the owner.
    error NotOwner(address caller);

    /// @notice The requested rate exceeds the protocol's sanity ceiling.
    error RateTooHigh(uint64 bps, uint64 maxBps);

    /// @notice Highest rate this adapter will publish: 50% per year.
    uint64 public constant MAX_RATE_BPS = 5_000;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /**
     * @param token_          Confidential asset to issue yield in.
     * @param owner_          Owner able to set the rate and the vault.
     * @param ratePerYearBps_ Initial published annual rate, in basis points.
     */
    constructor(SableConfidentialUSD token_, address owner_, uint64 ratePerYearBps_) {
        if (address(token_) == address(0) || owner_ == address(0)) revert SableErrors.ZeroAddress();
        if (ratePerYearBps_ > MAX_RATE_BPS) revert RateTooHigh(ratePerYearBps_, MAX_RATE_BPS);

        token = token_;
        owner = owner_;
        ratePerYearBps = ratePerYearBps_;
        yieldIndex = SableMath.INDEX_SCALE;
        lastAccrualAt = uint64(block.timestamp);

        emit YieldRateSet(ratePerYearBps_);
    }

    /// @inheritdoc ISableYieldAdapter
    function asset() external view returns (address) {
        return address(token);
    }

    /**
     * @notice Sets the vault permitted to draw yield.
     */
    function setVault(address vault_) external onlyOwner {
        if (vault_ == address(0)) revert SableErrors.ZeroAddress();
        vault = vault_;
    }

    /**
     * @notice Updates the published annual rate.
     * @dev    Brings the index up to date first, so a rate change never retroactively
     *         re-prices interest that already accrued under the previous rate.
     */
    function setRate(uint64 bps) external onlyOwner {
        if (bps > MAX_RATE_BPS) revert RateTooHigh(bps, MAX_RATE_BPS);
        _accrue();
        ratePerYearBps = bps;
        emit YieldRateSet(bps);
    }

    /// @inheritdoc ISableYieldAdapter
    function refreshYieldIndex() external returns (uint64) {
        return _accrue();
    }

    /**
     * @notice Preview of the index without mutating state.
     */
    function previewYieldIndex() external view returns (uint64) {
        return _previewIndex();
    }

    /// @inheritdoc ISableYieldAdapter
    function drawYield(euint64 amount) external returns (euint64 delivered) {
        if (msg.sender != vault) revert NotVault(msg.sender);

        // Hand the token transient access so it can compute on the handle, then issue.
        // Issuance is unconditional, which is what lets the vault credit the full amount:
        // a partial delivery could never be detected downstream, because every quantity
        // involved is a ciphertext.
        FHE.allowTransient(amount, address(token));
        delivered = token.mintConfidential(msg.sender, amount);

        emit YieldDrawn(msg.sender);
    }

    /**
     * @dev Advances the index by `rate * elapsed / year`, clamped to the protocol ceiling.
     *
     *      Linear rather than compounding: the vault multiplies balances by the index
     *      delta, and a linear index keeps that product's magnitude predictable — which is
     *      what the `euint64` overflow budget in `SableMath` is derived from.
     */
    function _accrue() private returns (uint64) {
        uint64 updated = _previewIndex();
        if (updated != yieldIndex) {
            emit YieldIndexUpdated(yieldIndex, updated, uint64(block.timestamp));
            yieldIndex = updated;
        }
        lastAccrualAt = uint64(block.timestamp);
        return updated;
    }

    function _previewIndex() private view returns (uint64) {
        uint64 elapsed = uint64(block.timestamp) - lastAccrualAt;
        if (elapsed == 0 || ratePerYearBps == 0) return yieldIndex;

        uint256 growth = (uint256(SableMath.INDEX_SCALE) * ratePerYearBps * elapsed) /
            (uint256(SableMath.BPS_DENOMINATOR) * SECONDS_PER_YEAR);

        uint256 updated = uint256(yieldIndex) + growth;
        if (updated > SableMath.MAX_YIELD_INDEX) return SableMath.MAX_YIELD_INDEX;
        return uint64(updated);
    }
}
