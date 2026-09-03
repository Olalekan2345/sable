// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title  IERC20Mintable
 * @notice The publicly mintable ERC-20 beneath Zama's confidential test wrappers.
 *
 * @dev    Zama's mock underlyings — for example `USDCMock`
 *         (`0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF`) — expose an unrestricted
 *         `mint(address,uint256)` capped at one million tokens per call. Both properties
 *         were verified against Sepolia rather than taken from the documentation.
 *
 *         Extends `IERC20Metadata` because the tooling also needs `decimals()`: a wrapper
 *         always reports 6, but the token beneath it may be 18, and both figures are needed
 *         to size a mint correctly.
 *
 *         Sable never deploys or controls these. This interface exists purely so the
 *         operator tooling can obtain test tokens and seed the yield reserve.
 */
interface IERC20Mintable is IERC20Metadata {
    /// @notice Mints test tokens. Public on Zama's mock underlyings.
    function mint(address to, uint256 amount) external;
}
