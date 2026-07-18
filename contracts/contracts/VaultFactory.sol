// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StrategyVault} from "./StrategyVault.sol";

interface IBotRegistry {
    function getBot(uint256 botId)
        external
        view
        returns (
            address creator,
            string memory name,
            string memory strategyURI,
            uint16 feeBps,
            bool active,
            uint64 subscriberCount,
            uint64 registeredAt
        );
}

/**
 * VaultFactory — deploys one StrategyVault per registered bot.
 *
 * Only the bot's registered creator can create its vault; the vault's
 * performance fee is snapshotted from the registry at creation so a
 * creator cannot raise fees on existing depositors afterwards.
 */
contract VaultFactory {
    IBotRegistry public immutable registry;
    address public immutable dex;

    mapping(uint256 => address) public vaultByBot;
    address[] public allVaults;

    event VaultCreated(uint256 indexed botId, address indexed vault, address indexed creator, address baseToken, uint16 feeBps);

    constructor(address registry_, address dex_) {
        registry = IBotRegistry(registry_);
        dex = dex_;
    }

    function createVault(
        uint256 botId,
        address baseToken,
        address[] calldata allowedTokens,
        uint16 maxTradeBps,
        uint32 tradeCooldown
    ) external returns (address vault) {
        require(vaultByBot[botId] == address(0), "Factory: vault exists");

        (address creator, , , uint16 feeBps, bool active, , ) = registry.getBot(botId);
        require(msg.sender == creator, "Factory: not bot creator");
        require(active, "Factory: bot inactive");

        vault = address(
            new StrategyVault(dex, botId, creator, baseToken, allowedTokens, feeBps, maxTradeBps, tradeCooldown)
        );
        vaultByBot[botId] = vault;
        allVaults.push(vault);

        emit VaultCreated(botId, vault, creator, baseToken, feeBps);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
