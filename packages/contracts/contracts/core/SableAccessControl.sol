// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {SableErrors} from "../libraries/SableErrors.sol";

/**
 * @title  SableAccessControl
 * @notice Minimal two-role access control plus an emergency pause.
 * @dev    Deliberately hand-written rather than inherited from a general-purpose access
 *         control library: Sable needs exactly two roles, and FHE-heavy bytecode leaves
 *         little headroom under the EIP-170 size limit.
 *
 *         **What an administrator cannot do.** There is no privileged path to a user's
 *         plaintext state anywhere in this protocol. Admins cannot decrypt balances, read
 *         the confidential mode, choose winners, re-run a completed round, or move user
 *         funds. The FHEVM ACL is the enforcement mechanism, not this contract: an admin
 *         is simply never granted `FHE.allow` on another account's ciphertext. Pausing
 *         stops new deposits and lifecycle progress; it never blocks withdrawals.
 */
abstract contract SableAccessControl {
    /// @notice Full control: role management, round configuration, adapter wiring.
    bytes32 public constant ADMIN_ROLE = keccak256("SABLE_ADMIN_ROLE");

    /**
     * @notice Vestigial. Gates nothing.
     * @dev    This once guarded the round lifecycle (open/close/batch/draw/settle). Those
     *         calls are now permissionless, so that a draw never depends on one key staying
     *         online and a saver waiting on a prize can settle the round themselves.
     *
     *         The constant is kept so the deployed ABI does not change under tooling that
     *         already reads it, but nothing in this codebase checks it and nothing new
     *         should. Granting it confers no capability whatsoever.
     */
    bytes32 public constant OPERATOR_ROLE = keccak256("SABLE_OPERATOR_ROLE");

    mapping(bytes32 role => mapping(address account => bool)) private _roles;

    /// @notice True while the protocol is paused.
    bool public paused;

    /// @notice Emitted when an account gains a role.
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);

    /// @notice Emitted when an account loses a role.
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    /// @notice Emitted when the protocol is paused or unpaused.
    event PausedSet(bool paused, address indexed sender);

    /// @dev Reverts unless the caller holds `role`.
    modifier onlyRole(bytes32 role) {
        if (!_roles[role][msg.sender]) revert SableErrors.Unauthorized(msg.sender, role);
        _;
    }

    /// @dev Reverts while the protocol is paused.
    modifier whenNotPaused() {
        if (paused) revert SableErrors.Paused();
        _;
    }

    /**
     * @param admin Initial holder of {ADMIN_ROLE} and {OPERATOR_ROLE}.
     */
    constructor(address admin) {
        if (admin == address(0)) revert SableErrors.ZeroAddress();
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    /**
     * @notice Returns whether `account` holds `role`.
     */
    function hasRole(bytes32 role, address account) public view returns (bool) {
        return _roles[role][account];
    }

    /**
     * @notice Grants `role` to `account`.
     */
    function grantRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        if (account == address(0)) revert SableErrors.ZeroAddress();
        _grantRole(role, account);
    }

    /**
     * @notice Revokes `role` from `account`.
     * @dev    No guard against removing the last admin: an intentionally bricked admin
     *         surface is a legitimate end state for a protocol that aims to be immutable.
     *         See `docs/ARCHITECTURE.md` on trust assumptions.
     */
    function revokeRole(bytes32 role, address account) external onlyRole(ADMIN_ROLE) {
        _roles[role][account] = false;
        emit RoleRevoked(role, account, msg.sender);
    }

    /**
     * @notice Pauses deposits, mode changes and lifecycle progress.
     * @dev    Withdrawals are never gated on `paused`. A saver can always retrieve their
     *         principal, which is the property the product promises.
     */
    function setPaused(bool value) external onlyRole(ADMIN_ROLE) {
        paused = value;
        emit PausedSet(value, msg.sender);
    }

    function _grantRole(bytes32 role, address account) private {
        _roles[role][account] = true;
        emit RoleGranted(role, account, msg.sender);
    }
}
