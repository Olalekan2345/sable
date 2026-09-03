// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

import {SableErrors} from "../libraries/SableErrors.sol";

/**
 * @title  SableConfidentialUSD
 * @notice A confidential (ERC-7984) test asset for the Sable testnet deployment.
 *
 * @dev    **This is a testnet asset and the contract says so in its own name and symbol.**
 *         It is not pegged to anything, not redeemable for anything, and carries no
 *         issuer. It exists because Sable needs a real ERC-7984 asset to custody, and
 *         inventing an address for someone else's confidential dollar — or shipping a UI
 *         that pretends a balance exists — was never an option.
 *
 *         Two issuance paths, both deliberate:
 *
 *         - {faucet} lets any wallet self-mint a fixed test allocation, rate-limited per
 *           address, so the public demo flow works without an operator in the loop.
 *         - {mint} is restricted to accounts holding {MINTER_ROLE}, which is granted to the
 *           yield adapter so that accrued yield is backed by real tokens rather than by
 *           book-keeping.
 *
 *         Balances here are encrypted by the token itself; Sable never sees a plaintext
 *         amount at any point in the deposit path.
 */
contract SableConfidentialUSD is ERC7984, ZamaEthereumConfig {
    /// @notice Accounts permitted to mint — in practice, the yield adapter.
    mapping(address account => bool) public isMinter;

    /// @notice Contract owner, able to manage minters.
    address public owner;

    /// @notice Amount dispensed by a single {faucet} call: 10,000 test USD.
    uint64 public constant FAUCET_AMOUNT = 10_000 * 1e6;

    /// @notice Minimum delay between {faucet} calls from one address.
    uint64 public constant FAUCET_COOLDOWN = 12 hours;

    /// @notice Timestamp of each address's last faucet claim.
    mapping(address account => uint64 timestamp) public lastFaucetAt;

    /// @notice Emitted when a wallet claims from the faucet.
    event FaucetClaimed(address indexed account, uint64 amount);

    /// @notice Emitted when a minter is added or removed.
    event MinterSet(address indexed account, bool allowed);

    /// @notice The faucet cooldown for this address has not elapsed.
    error FaucetCooldown(address account, uint64 availableAt);

    /// @notice Caller is not permitted to mint.
    error NotMinter(address account);

    /// @notice Caller is not the owner.
    error NotOwner(address account);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    constructor(address owner_)
        ERC7984("Sable Test USD", "cUSDS", "https://sable.finance/assets/cusds.json")
    {
        if (owner_ == address(0)) revert SableErrors.ZeroAddress();
        owner = owner_;
    }

    /// @inheritdoc ERC7984
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Grants or revokes minting rights.
     */
    function setMinter(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert SableErrors.ZeroAddress();
        isMinter[account] = allowed;
        emit MinterSet(account, allowed);
    }

    /**
     * @notice Mints a confidential amount to `to`.
     * @dev    Restricted to minters. The amount is trivially encrypted from a public value:
     *         issuance policy is a public property of a test asset, whereas the *balances*
     *         it produces remain confidential like any other.
     */
    function mint(address to, uint64 amount) external returns (euint64) {
        if (!isMinter[msg.sender]) revert NotMinter(msg.sender);
        euint64 encrypted = FHE.asEuint64(amount);
        FHE.allowThis(encrypted);
        return _mint(to, encrypted);
    }

    /**
     * @notice Mints a confidential amount whose value is chosen by the minter privately.
     * @dev    Used by the yield adapter, which computes what it owes homomorphically and
     *         therefore never holds a plaintext figure to pass to {mint}.
     *
     *         The caller must have granted this contract transient ACL access to `amount`.
     */
    function mintConfidential(address to, euint64 amount) external returns (euint64) {
        if (!isMinter[msg.sender]) revert NotMinter(msg.sender);
        if (!FHE.isAllowed(amount, address(this))) revert NotMinter(msg.sender);
        return _mint(to, amount);
    }

    /**
     * @notice Dispenses a fixed test allocation to the caller.
     * @dev    Rate-limited per address. The cooldown is a courtesy against draining, not a
     *         security control — this is a testnet faucet and its supply is not scarce.
     */
    function faucet() external returns (euint64) {
        uint64 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(msg.sender, last + FAUCET_COOLDOWN);
        }

        lastFaucetAt[msg.sender] = uint64(block.timestamp);

        euint64 amount = FHE.asEuint64(FAUCET_AMOUNT);
        FHE.allowThis(amount);

        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
        return _mint(msg.sender, amount);
    }

    /**
     * @notice Seconds remaining before `account` may claim from the faucet again.
     */
    function faucetAvailableIn(address account) external view returns (uint64) {
        uint64 last = lastFaucetAt[account];
        if (last == 0) return 0;
        uint64 ready = last + FAUCET_COOLDOWN;
        return block.timestamp >= ready ? 0 : ready - uint64(block.timestamp);
    }
}
