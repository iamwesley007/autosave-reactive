// SPDX-License-Identifier: MIT
// AutoSaveReactive — watches for incoming WETH payments to one saver on
// Ethereum Sepolia and asks the AutoSaveVault (via a Reactive callback) to
// set aside a configured cut of each payment as savings.
//
// Reactive Omni Buildathon — "Set It and Forget It" track.
// Written during the event window, November 2026.

pragma solidity ^0.8.29;

import { ISystemContract } from "../lib/reactive-lib-omni/src/interfaces/ISystemContract.sol";
import { IReactive } from "../lib/reactive-lib-omni/src/interfaces/IReactive.sol";
import { AbstractReactive } from "../lib/reactive-lib-omni/src/base/AbstractReactive.sol";

contract AutoSaveReactive is AbstractReactive {
    /// @notice Ethereum Sepolia chain ID (origin + destination chain).
    uint256 public constant ORIGIN_CHAIN_ID = 11155111;

    /// @notice Canonical WETH9 on Ethereum Sepolia.
    address public constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    /// @notice keccak256("Transfer(address,address,uint256)").
    uint256 public constant TRANSFER_TOPIC_0 =
        0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    /// @notice Gas limit requested for the destination-chain callback.
    /// Must be >= 100_000 (network minimum); 1M leaves ample room for the
    /// proxy's accounting plus the vault's transfer + bookkeeping.
    uint64 public constant CALLBACK_GAS_LIMIT = 1_000_000;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    address public immutable owner;
    address public immutable user;

    /// @notice Savings rate in basis points (1000 = 10%).
    uint256 public savingsRateBps;
    /// @notice Payments below this WETH amount are seen but not saved from.
    uint256 public minPayment;
    /// @notice AutoSaveVault on Sepolia. Zero until set via setVault().
    address public vault;
    bool public paused;

    /// @notice Lifetime stats, readable by anyone.
    uint256 public paymentsSeen;
    uint256 public totalReceived;
    uint256 public totalSaved;
    uint256 public lastSaveAt;

    event PaymentSeen(address indexed user, uint256 amount, uint256 saveAmount);
    event SavingsRateUpdated(uint256 savingsRateBps);
    event MinPaymentUpdated(uint256 minPayment);
    event VaultUpdated(address indexed vault);
    event Paused();
    event Resumed();

    error Unauthorized();
    error InvalidRate();
    error InvalidUser();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(
        address user_,
        uint256 savingsRateBps_,
        uint256 minPayment_,
        address vault_
    ) payable {
        if (user_ == address(0)) revert InvalidUser();
        if (savingsRateBps_ > BPS_DENOMINATOR) revert InvalidRate();
        owner = msg.sender;
        user = user_;
        savingsRateBps = savingsRateBps_;
        minPayment = minPayment_;
        vault = vault_;
        _subscribe();
    }

    /// @inheritdoc IReactive
    function react(LogRecord calldata log_) external override onlySystem {
        // Only WETH Transfer events addressed to the saver.
        if (log_.topic0 != TRANSFER_TOPIC_0) return;
        if (log_.topic2 != uint256(uint160(user))) return;
        // Transfer(address,address,uint256) has 3 topics; anything else is
        // not the event we subscribed to.
        if (log_.opCode != 3) return;

        uint256 amount = abi.decode(log_.data, (uint256));

        paymentsSeen += 1;
        totalReceived += amount;

        if (paused) return;
        if (amount < minPayment) return;
        if (savingsRateBps == 0) return;
        if (vault == address(0)) return;

        uint256 saveAmount = (amount * savingsRateBps) / BPS_DENOMINATOR;
        if (saveAmount == 0) return;

        totalSaved += saveAmount;
        lastSaveAt = block.timestamp;
        emit PaymentSeen(user, amount, saveAmount);

        // First payload argument is reserved: the network overwrites it
        // with this contract's address so the vault can authenticate us.
        bytes memory payload = abi.encodeWithSignature(
            "save(address,address,uint256)",
            address(0),
            user,
            saveAmount
        );
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: ORIGIN_CHAIN_ID,
                recipient: vault,
                gasLimit: CALLBACK_GAS_LIMIT,
                payload: payload
            })
        );
    }

    function setSavingsRate(uint256 savingsRateBps_) external onlyOwner {
        if (savingsRateBps_ > BPS_DENOMINATOR) revert InvalidRate();
        savingsRateBps = savingsRateBps_;
        emit SavingsRateUpdated(savingsRateBps_);
    }

    function setMinPayment(uint256 minPayment_) external onlyOwner {
        minPayment = minPayment_;
        emit MinPaymentUpdated(minPayment_);
    }

    function setVault(address vault_) external onlyOwner {
        vault = vault_;
        emit VaultUpdated(vault_);
    }

    /// @notice Stop watching. The subscription is removed so no further
    /// reactive transactions are delivered (or billed).
    function pause() external onlyOwner {
        if (paused) return;
        _unsubscribe();
        paused = true;
        emit Paused();
    }

    /// @notice Resume watching. Settles any debt first: a contract in debt
    /// receives nothing, so resubscribing while indebted would stay silent.
    function resume() external payable onlyOwner {
        if (!paused) return;
        _coverDebt();
        _subscribe();
        paused = false;
        emit Resumed();
    }

    /// @notice Settles outstanding debt from this contract's own balance.
    /// Open to any caller so a third party can fund and restart the
    /// contract (see the Reactive docs' coverDebt pattern).
    function coverDebt() external payable {
        _coverDebt();
    }

    /// @notice Rescue surplus lREACT. Never callable by anyone but owner.
    function withdraw(address payable to_, uint256 amount_) external onlyOwner {
        (bool ok, ) = to_.call{ value: amount_ }("");
        require(ok, "Transfer failed");
    }

    function _subscribe() internal {
        SYSTEM.subscribe(
            ORIGIN_CHAIN_ID,
            WETH,
            TRANSFER_TOPIC_0,
            REACTIVE_IGNORE,
            uint256(uint160(user)),
            REACTIVE_IGNORE
        );
    }

    function _unsubscribe() internal {
        SYSTEM.unsubscribe(
            ORIGIN_CHAIN_ID,
            WETH,
            TRANSFER_TOPIC_0,
            REACTIVE_IGNORE,
            uint256(uint160(user)),
            REACTIVE_IGNORE
        );
    }
}
