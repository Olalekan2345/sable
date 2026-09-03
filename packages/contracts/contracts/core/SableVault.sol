// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, ebool, externalEuint64, externalEbool} from "@fhevm/solidity/lib/FHE.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {SableCore} from "./SableCore.sol";
import {ISableYieldAdapter} from "../interfaces/ISableYieldAdapter.sol";
import {SableErrors} from "../libraries/SableErrors.sol";
import {SableMath} from "../libraries/SableMath.sol";
import {SableTypes} from "../libraries/SableTypes.sol";

/**
 * @title  SableVault
 * @notice Confidential savings: deposits, withdrawals, rewards, and the private yield mode.
 * @dev    Every externally visible action here is designed so that an observer watching
 *         Sepolia learns *that* an account interacted with Sable and nothing else. Amounts
 *         arrive as ciphertext-plus-proof, mode arrives as ciphertext-plus-proof, and the
 *         emitted events carry only an address.
 */
abstract contract SableVault is SableCore {
    constructor(
        IERC7984 asset_,
        ISableYieldAdapter adapter,
        address admin,
        uint32 cap
    ) SableCore(asset_, adapter, admin, cap) {}

    // -------------------------------------------------------------------------
    // Deposit
    // -------------------------------------------------------------------------

    /**
     * @notice Deposits a confidential amount into the caller's savings position.
     *
     * @dev    The caller must first call `setOperator(vault, expiry)` on the asset —
     *         ERC-7984's approval model is operator-based rather than allowance-based.
     *
     *         Three details in this function are load-bearing:
     *
     *         1. **Headroom is applied before the transfer, not after.** The protocol caps
     *            a single balance at {SableMath.MAX_CONFIDENTIAL_BALANCE} so that
     *            `balance * indexDelta` and `balance * elapsedUnits` cannot approach `2^63`
     *            — `euint64` arithmetic wraps silently instead of reverting, so an overflow
     *            here would corrupt a balance with no on-chain symptom. Because the branch
     *            cannot be taken conditionally, the cap is applied by *clamping the request*
     *            (`FHE.min(requested, headroom)`) before any tokens move, rather than by
     *            transferring first and rejecting after.
     *
     *         2. **The credited value is the token's return handle, not the request.**
     *            An ERC-7984 transfer does not revert when the payer is short — it is
     *            all-or-nothing and returns an encrypted **zero**
     *            (`transferred = select(success, amount, 0)` in `ERC7984._update`).
     *            Crediting `toTake` would therefore let anyone mint savings balance simply
     *            by requesting more than they hold, and no revert would ever surface it.
     *
     *            The product consequence is that an over-sized deposit is a silent no-op
     *            rather than a partial fill, so the web app decrypts the caller's wallet
     *            balance and clamps the amount *before* submitting. That check is a UX
     *            affordance, not a security control: this line is the security control.
     *
     *         3. **`allowTransient` scopes the grant to this call.** The asset contract
     *            needs to compute on `toTake`, but only for the duration of this
     *            transaction — a permanent grant would leave the token able to read that
     *            handle forever.
     *
     * @param encryptedAmount Externally encrypted deposit amount.
     * @param inputProof      Zero-knowledge proof produced by the relayer SDK.
     */
    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external whenNotPaused {
        _accrueYieldIndex();
        _ensureRegistered(msg.sender);
        _checkpoint(msg.sender);

        SableTypes.Position storage position = _accounts[msg.sender];

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 headroom = FHE.sub(SableMath.MAX_CONFIDENTIAL_BALANCE, position.balance);
        euint64 toTake = FHE.min(requested, headroom);

        FHE.allowTransient(toTake, address(asset));
        euint64 credited = asset.confidentialTransferFrom(msg.sender, address(this), toTake);

        position.balance = FHE.add(position.balance, credited);
        _persist(position.balance, msg.sender);

        _totalDeposits = _accumulate(_totalDeposits, credited);
        FHE.allowThis(_totalDeposits);

        emit PrivateDeposit(msg.sender);
    }

    // -------------------------------------------------------------------------
    // Withdraw
    // -------------------------------------------------------------------------

    /**
     * @notice Withdraws a confidential amount of savings back to the caller.
     *
     * @dev    Deliberately **not** gated on `whenNotPaused`. A saver must be able to leave
     *         even while the protocol is halted; a pause that traps principal would make
     *         the product's central promise conditional on operator behaviour.
     *
     *         There is no lock-up and no round-based exit restriction. Withdrawing during
     *         an open round simply reduces the balance that subsequent weight accrues on —
     *         the checkpoint immediately before the mutation books the weight already
     *         earned, and nothing after it.
     *
     *         The amount is clamped to the available balance rather than checked against
     *         it: a comparison would have to be resolved to a plaintext boolean to drive a
     *         revert, and that boolean would leak whether the caller holds at least the
     *         requested amount.
     *
     * @param encryptedAmount Externally encrypted withdrawal amount.
     * @param inputProof      Zero-knowledge proof produced by the relayer SDK.
     */
    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        if (!isParticipant(msg.sender)) revert SableErrors.NotAParticipant(msg.sender);

        _accrueYieldIndex();
        _checkpoint(msg.sender);

        SableTypes.Position storage position = _accounts[msg.sender];

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 amount = FHE.min(requested, position.balance);

        // Effects before interaction: the balance is reduced before the asset call.
        position.balance = FHE.sub(position.balance, amount);
        _persist(position.balance, msg.sender);

        _totalDeposits = FHE.sub(_totalDeposits, amount);
        FHE.allowThis(_totalDeposits);

        FHE.allowTransient(amount, address(asset));
        asset.confidentialTransfer(msg.sender, amount);

        emit PrivateWithdrawal(msg.sender);
    }

    // -------------------------------------------------------------------------
    // Confidential mode
    // -------------------------------------------------------------------------

    /**
     * @notice Sets the caller's confidential yield mode.
     *
     * @dev    **This is Sable's headline feature and the reason the signature looks like
     *         this.** There is exactly one function, taking one opaque ciphertext. There is
     *         no `enableLucky()` / `enableSteady()` pair, no boolean argument, no mode in
     *         the event, and no branch on the value anywhere in the protocol. Steady and
     *         Lucky produce byte-identical calldata shapes and byte-identical logs; the two
     *         are distinguishable only to the account itself, through user decryption.
     *
     *         The checkpoint runs *before* the bit flips, which is what makes the switch
     *         non-retroactive in both directions: eligibility already earned under Lucky is
     *         kept, and Steady time is never converted into eligibility after the fact.
     *
     * @param encryptedMode Externally encrypted boolean. True selects Lucky.
     * @param inputProof    Zero-knowledge proof produced by the relayer SDK.
     */
    function setMode(externalEbool encryptedMode, bytes calldata inputProof) external whenNotPaused {
        _accrueYieldIndex();
        _ensureRegistered(msg.sender);
        _checkpoint(msg.sender);

        SableTypes.Position storage position = _accounts[msg.sender];

        position.isLucky = FHE.fromExternal(encryptedMode, inputProof);
        _persistBool(position.isLucky, msg.sender);

        emit PrivateModeUpdated(msg.sender);
    }

    // -------------------------------------------------------------------------
    // Rewards
    // -------------------------------------------------------------------------

    /**
     * @notice Moves confidential prize winnings into the caller's savings balance.
     *
     * @dev    Rewards are held in a separate handle until claimed so that a saver can see
     *         "what I won" distinctly from "what I saved" — the statement and rewards
     *         screens both depend on that separation.
     *
     *         The claim is clamped by headroom for the same overflow reason as
     *         {deposit}; any excess simply remains in the reward handle.
     */
    function claimRewards() external {
        if (!isParticipant(msg.sender)) revert SableErrors.NotAParticipant(msg.sender);

        _accrueYieldIndex();
        _checkpoint(msg.sender);

        SableTypes.Position storage position = _accounts[msg.sender];

        euint64 headroom = FHE.sub(SableMath.MAX_CONFIDENTIAL_BALANCE, position.balance);
        euint64 moved = FHE.min(position.reward, headroom);

        position.reward = FHE.sub(position.reward, moved);
        position.balance = FHE.add(position.balance, moved);

        _persist(position.reward, msg.sender);
        _persist(position.balance, msg.sender);

        _totalDeposits = _accumulate(_totalDeposits, moved);
        FHE.allowThis(_totalDeposits);

        emit PrivateRewardsClaimed(msg.sender);
    }

    // -------------------------------------------------------------------------
    // Confidential views
    // -------------------------------------------------------------------------
    //
    // These return ciphertext *handles*, not values. Anyone may call them; the returned
    // handle is useless without an ACL grant, which only the owning account has. This is
    // what lets the frontend fetch a handle with a plain `eth_call` and then decrypt it
    // locally under the user's own EIP-712 authorisation.

    /// @notice Handle for `account`'s savings balance (principal plus Steady yield).
    function confidentialBalanceOf(address account) external view returns (euint64) {
        return _accounts[account].balance;
    }

    /// @notice Handle for `account`'s unclaimed prize rewards.
    function confidentialRewardOf(address account) external view returns (euint64) {
        return _accounts[account].reward;
    }

    /// @notice Handle for `account`'s confidential mode. True means Lucky.
    function confidentialModeOf(address account) external view returns (ebool) {
        return _accounts[account].isLucky;
    }

    /// @notice Handle for `account`'s time-weighted eligibility in `roundId`.
    function confidentialWeightOf(uint256 roundId, address account) external view returns (euint64) {
        return _roundWeight[roundId][account];
    }

    /// @notice Handle for the encrypted total principal held by the vault.
    /// @dev    Aggregate only. Never granted to any individual account.
    function confidentialTotalDeposits() external view returns (euint64) {
        return _totalDeposits;
    }
}
