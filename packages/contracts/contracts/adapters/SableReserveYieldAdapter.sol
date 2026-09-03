// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {ISableYieldAdapter} from "../interfaces/ISableYieldAdapter.sol";
import {SableErrors} from "../libraries/SableErrors.sol";
import {SableMath} from "../libraries/SableMath.sol";

/// @dev The subset of `ERC7984ERC20Wrapper` this adapter needs.
interface IConfidentialWrapper {
    function underlying() external view returns (address);
    function rate() external view returns (uint256);
    function wrap(address to, uint256 amount) external returns (euint64);
}

/**
 * @title  SableReserveYieldAdapter
 * @notice Yield adapter for confidential assets Sable does not control.
 *
 * @dev    ## Why this exists alongside the mint-based adapter
 *
 *         Zama publishes canonical confidential test assets on Sepolia — `cUSDCMock` and
 *         friends — which are `ERC7984ERC20Wrapper`s over publicly mintable ERC-20s. Using
 *         them is strictly better than Sable minting its own token: it is the asset the
 *         ecosystem actually uses, and it removes any suspicion that the protocol is
 *         conjuring its own money.
 *
 *         But Sable has no minting rights on somebody else's token, so
 *         {SableTestnetYieldAdapter}'s approach — issue yield on demand — is unavailable.
 *         This adapter pays yield from a **pre-funded reserve** instead.
 *
 *         ## Solvency is enforced, not assumed
 *
 *         A reserve that runs dry would be a silent catastrophe. ERC-7984 transfers are
 *         all-or-nothing and return an encrypted zero rather than reverting, so the vault
 *         would credit yield the adapter never delivered, and *no later transaction could
 *         detect it* — every quantity involved is a ciphertext.
 *
 *         So the index is capped by what the reserve provably covers:
 *
 *         ```
 *         maxIndexDelta = fundedTotal × INDEX_SCALE / coveredDeposits
 *         ```
 *
 *         where `coveredDeposits` is a **public upper bound** on everything the vault could
 *         ever custody (`participantCap × MAX_CONFIDENTIAL_BALANCE`). Cumulative yield owed
 *         is `totalDeposits × indexDelta / INDEX_SCALE`, and since
 *         `totalDeposits ≤ coveredDeposits`, that is bounded above by `fundedTotal` for all
 *         time. The reserve therefore cannot be exhausted, and `drawYield` cannot silently
 *         under-deliver.
 *
 *         The bound is deliberately conservative — it assumes every participant is at the
 *         maximum balance — so the index advances more slowly than a perfectly-sized reserve
 *         would allow. That is the correct direction to err: the alternative is a protocol
 *         that credits yield it does not hold.
 *
 *         ## Why funding goes through the underlying ERC-20
 *
 *         A sponsor could transfer the confidential token directly, but then the adapter
 *         could not know how much it received — the amount is a ciphertext, and trusting a
 *         caller-supplied figure would let a mistaken or malicious sponsor overstate the
 *         reserve and break the solvency bound.
 *
 *         Funding therefore takes the *public* ERC-20 and wraps it here. A standard ERC-20
 *         transfer either moves the full amount or reverts, so `fundedTotal` is exact and
 *         independently verifiable on the block explorer.
 */
contract SableReserveYieldAdapter is ISableYieldAdapter, ZamaEthereumConfig {
    using SafeERC20 for IERC20;

    /// @notice The confidential asset yield is paid in.
    IERC7984 public immutable token;

    /// @notice The same address, typed as its wrapper interface.
    IConfidentialWrapper public immutable wrapper;

    /// @notice Public upper bound on the vault's total deposits.
    /// @dev    `participantCap × MAX_CONFIDENTIAL_BALANCE`. The solvency bound rests on this.
    uint64 public immutable coveredDeposits;

    /// @notice The only address permitted to draw yield.
    address public vault;

    /// @notice Owner, able to set the rate and the vault.
    address public owner;

    /// @inheritdoc ISableYieldAdapter
    uint64 public yieldIndex;

    /// @notice Published annual rate, in basis points.
    uint64 public ratePerYearBps;

    /// @notice Timestamp the index was last advanced.
    uint64 public lastAccrualAt;

    /// @notice Total confidential units wrapped into this adapter as reserve.
    /// @dev    Public and exact: funding moves a public ERC-20 amount, which reverts on
    ///         failure rather than partially settling.
    uint64 public fundedTotal;

    uint64 private constant SECONDS_PER_YEAR = 365 days;

    /// @notice Highest rate this adapter will publish: 50% per year.
    uint64 public constant MAX_RATE_BPS = 5_000;

    /// @notice Emitted when a sponsor adds to the reserve.
    event ReserveFunded(address indexed sponsor, uint256 underlyingAmount, uint64 confidentialAmount);

    error NotVault(address caller);
    error NotOwner(address caller);
    error RateTooHigh(uint64 bps, uint64 maxBps);
    error NothingToFund();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /**
     * @param wrapper_         Confidential asset, which must be an ERC-20 wrapper.
     * @param owner_           Owner able to set the rate and the vault.
     * @param ratePerYearBps_  Initial published annual rate, in basis points.
     * @param coveredDeposits_ Public upper bound on the vault's total deposits.
     */
    constructor(
        IConfidentialWrapper wrapper_,
        address owner_,
        uint64 ratePerYearBps_,
        uint64 coveredDeposits_
    ) {
        if (address(wrapper_) == address(0) || owner_ == address(0)) revert SableErrors.ZeroAddress();
        if (ratePerYearBps_ > MAX_RATE_BPS) revert RateTooHigh(ratePerYearBps_, MAX_RATE_BPS);
        if (coveredDeposits_ == 0) revert SableErrors.InvalidParticipantCap(0);

        wrapper = wrapper_;
        token = IERC7984(address(wrapper_));
        owner = owner_;
        ratePerYearBps = ratePerYearBps_;
        coveredDeposits = coveredDeposits_;
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
     * @dev    Accrues to the present first, so a rate change never retroactively re-prices
     *         interest that already accrued under the previous rate.
     */
    function setRate(uint64 bps) external onlyOwner {
        if (bps > MAX_RATE_BPS) revert RateTooHigh(bps, MAX_RATE_BPS);
        _accrue();
        ratePerYearBps = bps;
        emit YieldRateSet(bps);
    }

    /**
     * @notice Adds `underlyingAmount` of the underlying ERC-20 to the reserve.
     *
     * @dev    Permissionless: anyone may sponsor yield, and doing so can only increase the
     *         protocol's ability to pay. The caller must have approved this adapter for the
     *         underlying token first.
     *
     *         The adapter pulls the public ERC-20, then wraps it into the confidential asset.
     *         Because the ERC-20 leg reverts on failure rather than partially settling,
     *         `fundedTotal` is exact — which is what the solvency bound depends on.
     */
    function fund(uint256 underlyingAmount) external {
        if (underlyingAmount == 0) revert NothingToFund();

        IERC20 underlying = IERC20(wrapper.underlying());
        uint256 rate = wrapper.rate();

        // The wrapper floors to a multiple of `rate`; mirror that so accounting is exact.
        uint256 usable = underlyingAmount - (underlyingAmount % rate);
        if (usable == 0) revert NothingToFund();

        underlying.safeTransferFrom(msg.sender, address(this), usable);
        underlying.forceApprove(address(wrapper), usable);
        wrapper.wrap(address(this), usable);

        uint64 confidentialAmount = uint64(usable / rate);
        fundedTotal += confidentialAmount;

        emit ReserveFunded(msg.sender, usable, confidentialAmount);
    }

    /**
     * @notice The highest index this adapter will publish, given its funded reserve.
     * @dev    This is the solvency bound. See the contract-level documentation.
     */
    function maxIndex() public view returns (uint64) {
        uint256 delta = (uint256(fundedTotal) * SableMath.INDEX_SCALE) / coveredDeposits;
        uint256 ceiling = uint256(SableMath.INDEX_SCALE) + delta;
        return ceiling > SableMath.MAX_YIELD_INDEX ? SableMath.MAX_YIELD_INDEX : uint64(ceiling);
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

        // The index cap guarantees the reserve covers this, so the all-or-nothing transfer
        // cannot silently deliver zero.
        FHE.allowTransient(amount, address(token));
        delivered = token.confidentialTransfer(msg.sender, amount);

        emit YieldDrawn(msg.sender);
    }

    /**
     * @notice The adapter's confidential reserve handle.
     * @dev    Reserve depth is a public solvency property rather than anyone's private
     *         position, so `fundedTotal` is published in plaintext and this handle exists
     *         only for completeness.
     */
    function reserveHandle() external view returns (euint64) {
        return token.confidentialBalanceOf(address(this));
    }

    /// @dev Advances the index by `rate × elapsed / year`, clamped to {maxIndex}.
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
        uint64 ceiling = maxIndex();

        return updated > ceiling ? ceiling : uint64(updated);
    }
}
