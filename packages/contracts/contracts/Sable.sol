// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {SablePrizeEngine} from "./core/SablePrizeEngine.sol";
import {ISableYieldAdapter} from "./interfaces/ISableYieldAdapter.sol";

/**
 * @title  Sable
 * @notice A confidential prize-linked savings protocol.
 *
 *         Save privately. Win fairly.
 *
 * @dev    Savers deposit a confidential asset and privately choose what happens to the
 *         yield their savings generate:
 *
 *         - **Steady** — the yield compounds into their own savings position.
 *         - **Lucky**  — the yield goes to a shared prize pool, and their savings earn
 *           time-weighted entry into that round's confidential draw.
 *
 *         Principal is never at stake in either mode. Prizes are funded from yield, and
 *         there is no code path in this protocol that moves one saver's principal into
 *         another saver's reward.
 *
 *         What makes Sable different from an encrypted-balance savings pool is that the
 *         **choice itself is encrypted**. `setMode` takes a single opaque ciphertext, and
 *         eligibility is computed with `FHE.select` over that encrypted bit, so no
 *         observer can tell whether a wallet is playing or saving.
 *
 *         This contract is deliberately non-upgradeable. For a protocol custodying savings
 *         with a small, immutable rule set, a proxy would add an admin capability strictly
 *         more dangerous than the bugs it could fix.
 *
 *         Composition (single deployed contract — see {SableCore} for why):
 *
 *         ```
 *         SableAccessControl ─┐
 *                             ├─ SableCore ─ SableVault ─ SablePrizeEngine ─ Sable
 *         ZamaEthereumConfig ─┘
 *         ```
 */
contract Sable is SablePrizeEngine {
    /// @notice Human-readable protocol version, surfaced by the app's about/security pages.
    string public constant VERSION = "1.0.0";

    /**
     * @param asset_  ERC-7984 confidential asset accepted for deposits.
     * @param adapter Yield index source.
     * @param admin   Initial admin and operator.
     * @param cap     Initial participant cap, sized from measured HCU cost.
     */
    constructor(
        IERC7984 asset_,
        ISableYieldAdapter adapter,
        address admin,
        uint32 cap
    ) SablePrizeEngine(asset_, adapter, admin, cap) {}
}
