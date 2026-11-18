// SPDX-License-Identifier: MIT
// AutoSaveVault — destination-chain callback contract for AutoSave.
//
// Receives authenticated callbacks from AutoSaveReactive (Lasna) whenever
// the saver is paid in WETH on Sepolia, pulls the savings cut from the
// saver's wallet using a pre-approved allowance, and credits it to their
// savings ledger. Savings are withdrawable by the saver at any time.
//
// Reactive Omni Buildathon — "Set It and Forget It" track.
// Written during the event window, November 2026.

pragma solidity ^0.8.29;

import { IPayable } from "../lib/reactive-lib-omni/src/interfaces/IPayable.sol";
import { AbstractCallback } from "../lib/reactive-lib-omni/src/base/AbstractCallback.sol";

interface IWETH {
    function transfer(address to_, uint256 amount_) external returns (bool);
    function transferFrom(address from_, address to_, uint256 amount_) external returns (bool);
    function balanceOf(address account_) external view returns (uint256);
    function allowance(address owner_, address spender_) external view returns (uint256);
}

contract AutoSaveVault is AbstractCallback {
    IWETH public immutable weth;

    /// @notice WETH saved per saver. Only ever increased by authenticated
    /// callbacks, only ever decreased by that saver's own withdrawals.
    mapping(address => uint256) public savings;
    uint256 public totalSaved;

    event Saved(address indexed user, uint256 amount, uint256 totalForUser);
    event SaveSkipped(address indexed user, uint256 requested);
    event Withdrawn(address indexed user, uint256 amount);

    error InvalidWETH();
    error InsufficientSavings();

    constructor(IPayable callbackProxy_, address callbackSender_, address weth_)
        payable
        AbstractCallback(callbackProxy_, callbackSender_)
    {
        if (weth_ == address(0)) revert InvalidWETH();
        weth = IWETH(weth_);
    }

    /// @notice Called by the Reactive callback proxy on behalf of the
    /// authorized reactive contract. Pulls the savings cut from the saver
    /// via their pre-approved allowance.
    /// @dev Never reverts on insufficient allowance/balance: a failed
    /// callback is still billed in full, so we clamp and skip instead.
    function save(address reactive_, address user_, uint256 amount_)
        external
        onlyServiceProvider
        onlyCallbackSender(reactive_)
    {
        uint256 pull = amount_;
        uint256 allowed = weth.allowance(user_, address(this));
        if (pull > allowed) pull = allowed;
        uint256 balance = weth.balanceOf(user_);
        if (pull > balance) pull = balance;

        if (pull == 0) {
            emit SaveSkipped(user_, amount_);
            return;
        }

        if (!weth.transferFrom(user_, address(this), pull)) revert TransferFailed();
        savings[user_] += pull;
        totalSaved += pull;
        emit Saved(user_, pull, savings[user_]);
    }

    /// @notice Reclaim saved WETH. Only the saver's own ledger can be drawn.
    function withdraw(uint256 amount_) external {
        if (savings[msg.sender] < amount_) revert InsufficientSavings();
        savings[msg.sender] -= amount_;
        totalSaved -= amount_;
        if (!weth.transfer(msg.sender, amount_)) revert TransferFailed();
        emit Withdrawn(msg.sender, amount_);
    }

    /// @notice Settles outstanding debt to the callback proxy from this
    /// contract's own balance. Open to any caller so a third party can
    /// fund and restart the contract.
    function coverDebt() external payable {
        _coverDebt();
    }
}
