// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Test-only token that skims 2% of every transfer to a fee sink —
/// used to prove the AMM's balance-delta reserve accounting holds up.
contract FeeOnTransferMock is ERC20 {
    uint256 public constant FEE_BPS = 200;
    address public immutable feeSink;

    constructor() ERC20("Fee Token", "FEE") {
        feeSink = msg.sender;
        _mint(msg.sender, 1_000_000e18);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && to != feeSink) {
            uint256 fee = (value * FEE_BPS) / 10_000;
            super._update(from, feeSink, fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}
