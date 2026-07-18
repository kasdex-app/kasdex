// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * Testnet-only ERC20 with an open faucet mint (capped per call).
 * Anyone can mint up to 10,000 tokens per call — convenient for testers,
 * obviously never deployable to mainnet.
 */
contract MockERC20 is ERC20 {
    uint256 public constant FAUCET_CAP = 10_000e18;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        require(amount <= FAUCET_CAP, "MockERC20: faucet cap");
        _mint(to, amount);
    }
}
