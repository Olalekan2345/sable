// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";

/**
 * @title  MockConfidentialUSDWrapper
 * @notice Local stand-in for Zama's `cUSDCMock` confidential wrapper.
 *
 * @dev    `ERC7984ERC20Wrapper` is abstract, so a concrete subclass is needed to exercise
 *         the wrapper path in tests. This mirrors the shape of Zama's deployed
 *         `Confidential USDC (Mock)` (`0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`):
 *         a wrapper over a six-decimal ERC-20, giving `rate() == 1` and `decimals() == 6`.
 *
 *         Deployed **only in tests**. On Sepolia, Sable points at Zama's real contract.
 */
contract MockConfidentialUSDWrapper is ERC7984ERC20Wrapper, ZamaEthereumConfig {
    constructor(
        IERC20 underlying_
    )
        ERC7984ERC20Wrapper(underlying_)
        ERC7984("Confidential USDC (Mock)", "cUSDCMock", "https://sable.finance/assets/cusdc-mock.json")
    {}

    // `decimals` needs no override here: `ERC7984ERC20Wrapper` already resolves it against
    // `ERC7984` and derives the value from the underlying token.
}
