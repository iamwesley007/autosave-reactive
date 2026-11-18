// SPDX-License-Identifier: MIT
// MockSystem — test-only stand-in for the Reactive system contract.
// Deployed locally, then its runtime code is placed at the real SYSTEM
// address (0x8888...8888) via hardhat_setCode so reactive contracts under
// test call into it. All calls are recorded as events, which the tests
// read from transaction receipts.
pragma solidity ^0.8.29;

import { ISystemContract } from "../../lib/reactive-lib-omni/src/interfaces/ISystemContract.sol";

contract MockSystem is ISystemContract {
    event Subscribed(
        address indexed subscriber,
        uint256 chainId,
        address contractAddr,
        uint256 topic0,
        uint256 topic1,
        uint256 topic2,
        uint256 topic3
    );
    event Unsubscribed(
        address indexed subscriber,
        uint256 chainId,
        address contractAddr,
        uint256 topic0,
        uint256 topic1,
        uint256 topic2,
        uint256 topic3
    );
    event CallbackRequested(
        address indexed sender,
        uint256 chainId,
        address recipient,
        uint64 gasLimit,
        bytes payload
    );

    receive() external payable {}

    function debt(address) external pure returns (uint256) {
        return 0;
    }

    function subscribe(
        uint256 chainId_,
        address contract_,
        uint256 topic0_,
        uint256 topic1_,
        uint256 topic2_,
        uint256 topic3_
    ) external {
        emit Subscribed(msg.sender, chainId_, contract_, topic0_, topic1_, topic2_, topic3_);
    }

    function unsubscribe(
        uint256 chainId_,
        address contract_,
        uint256 topic0_,
        uint256 topic1_,
        uint256 topic2_,
        uint256 topic3_
    ) external {
        emit Unsubscribed(msg.sender, chainId_, contract_, topic0_, topic1_, topic2_, topic3_);
    }

    function requestCallback(CallbackVersion, bytes memory) external pure {
        revert("use requestCallbackV_1_0 in tests");
    }

    function requestCallbackV_1_0(CallbackConfiguration_V_1_0 memory config_) external {
        emit CallbackRequested(msg.sender, config_.chainId, config_.recipient, config_.gasLimit, config_.payload);
    }
}
