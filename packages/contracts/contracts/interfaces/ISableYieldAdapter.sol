// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

/**
 * @title  ISableYieldAdapter
 * @notice Abstraction over whatever produces yield for the Sable vault.
 * @dev    The adapter publishes a **public, monotonically increasing index**. The vault
 *         never asks the adapter "how much did account X earn?" — it could not, because
 *         balances are encrypted and there is no encrypted-by-encrypted division in FHEVM.
 *         Instead the vault multiplies each account's encrypted balance by the public
 *         index delta, which is exact and costs a single scalar multiply.
 *
 *         Because the index is public, so is Sable's yield rate. That is a deliberate
 *         trade: the *rate* is a protocol parameter, the *balances it applies to* are not.
 */
interface ISableYieldAdapter {
    /// @notice Emitted whenever the published index advances.
    event YieldIndexUpdated(uint64 previousIndex, uint64 newIndex, uint64 timestamp);

    /// @notice Emitted when the vault draws accrued yield from the adapter.
    /// @dev    Carries no amount: the amount is a ciphertext and must stay that way.
    event YieldDrawn(address indexed vault);

    /// @notice Emitted when the published yield rate changes.
    event YieldRateSet(uint64 ratePerYearBps);

    /**
     * @notice The confidential asset this adapter pays yield in.
     */
    function asset() external view returns (address);

    /**
     * @notice Current value of the public yield index, scaled by `SableMath.INDEX_SCALE`.
     * @dev    Monotonically non-decreasing. Starts at `INDEX_SCALE`.
     */
    function yieldIndex() external view returns (uint64);

    /**
     * @notice Brings {yieldIndex} up to date with elapsed time and returns it.
     * @dev    State-changing. The vault calls this before any operation that touches an
     *         encrypted balance, so that accrual is always evaluated at the same index for
     *         every account within a transaction.
     */
    function refreshYieldIndex() external returns (uint64);

    /**
     * @notice Delivers `amount` of the confidential asset to the calling vault.
     * @dev    Callable only by the registered vault. The vault must have granted the
     *         adapter transient ACL access to `amount` in the same transaction.
     *
     *         Implementations must deliver the full `amount` or revert. Partial delivery
     *         would leave the vault crediting yield it does not custody, breaking the
     *         solvency invariant in a way no later transaction could detect — every figure
     *         involved is a ciphertext, so there is nothing to reconcile against.
     */
    function drawYield(euint64 amount) external returns (euint64 delivered);
}
