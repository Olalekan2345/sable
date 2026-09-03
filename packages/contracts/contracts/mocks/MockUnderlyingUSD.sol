// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title  MockUnderlyingUSD
 * @notice Local stand-in for Zama's publicly mintable test ERC-20.
 *
 * @dev    Mirrors `USDCMock` (`0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF`) on Sepolia:
 *         six decimals, and a `mint` anyone may call up to one million tokens per call.
 *
 *         This exists **only so the wrapper path can be tested locally**, where Zama's
 *         deployed assets do not exist. The Sepolia deployment uses Zama's real contracts;
 *         nothing in this file is deployed there.
 */
contract MockUnderlyingUSD is ERC20 {
    /// @notice Matches the documented per-call limit on Zama's mock.
    uint256 public constant MAX_MINT_PER_CALL = 1_000_000 * 1e6;

    error MintLimitExceeded(uint256 amount, uint256 limit);

    constructor() ERC20("USD Coin (Mock)", "USDCMock") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints test tokens. Public, exactly as Zama's mock is.
    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT_PER_CALL) revert MintLimitExceeded(amount, MAX_MINT_PER_CALL);
        _mint(to, amount);
    }
}
