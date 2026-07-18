// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * Wrapped native KAS (WETH9 pattern). On Igra the native token is iKAS,
 * on Kasplex it is bridged KAS; either way this wraps the chain's native
 * currency 1:1 into an ERC20 the AMM can pool.
 */
contract WKAS is ERC20 {
    event Deposit(address indexed to, uint256 amount);
    event Withdrawal(address indexed from, uint256 amount);

    constructor() ERC20("Wrapped KAS", "WKAS") {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        emit Withdrawal(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "WKAS: transfer failed");
    }
}
