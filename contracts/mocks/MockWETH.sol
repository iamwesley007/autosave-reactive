// SPDX-License-Identifier: MIT
// MockWETH — minimal ERC-20 with WETH-style semantics for local tests.
pragma solidity ^0.8.29;

contract MockWETH {
    string public name = "Mock WETH";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to_, uint256 amount_) external {
        balanceOf[to_] += amount_;
        emit Transfer(address(0), to_, amount_);
    }

    function approve(address spender_, uint256 amount_) external returns (bool) {
        allowance[msg.sender][spender_] = amount_;
        emit Approval(msg.sender, spender_, amount_);
        return true;
    }

    function transfer(address to_, uint256 amount_) external returns (bool) {
        return _transfer(msg.sender, to_, amount_);
    }

    function transferFrom(address from_, address to_, uint256 amount_) external returns (bool) {
        uint256 allowed = allowance[from_][msg.sender];
        require(allowed >= amount_, "insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from_][msg.sender] = allowed - amount_;
        }
        return _transfer(from_, to_, amount_);
    }

    function _transfer(address from_, address to_, uint256 amount_) internal returns (bool) {
        require(balanceOf[from_] >= amount_, "insufficient balance");
        balanceOf[from_] -= amount_;
        balanceOf[to_] += amount_;
        emit Transfer(from_, to_, amount_);
        return true;
    }
}
