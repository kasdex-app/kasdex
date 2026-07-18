// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * BotRegistry — on-chain registry for third-party trading-bot strategies.
 *
 * Phase 2 scope: creators register strategies (metadata + fee), traders
 * subscribe/unsubscribe, everything is emitted as events for the indexer.
 * Funds NEVER touch this contract — execution stays off-chain until the
 * Phase 3 non-custodial vaults land. Performance numbers are creator-reported
 * for now and flagged as such; verified on-chain performance comes with vaults.
 */
contract BotRegistry {
    struct Bot {
        address creator;
        string name;
        string strategyURI; // off-chain metadata (IPFS/HTTPS JSON)
        uint16 feeBps;      // creator's performance fee, e.g. 2000 = 20%
        bool active;
        uint64 subscriberCount;
        uint64 registeredAt;
    }

    uint16 public constant MAX_FEE_BPS = 3_000; // 30%

    Bot[] private bots;
    // botId => subscriber => subscribed?
    mapping(uint256 => mapping(address => bool)) public isSubscribed;

    event BotRegistered(uint256 indexed botId, address indexed creator, string name, uint16 feeBps, string strategyURI);
    event BotStatusChanged(uint256 indexed botId, bool active);
    event BotFeeChanged(uint256 indexed botId, uint16 feeBps);
    event Subscribed(uint256 indexed botId, address indexed trader);
    event Unsubscribed(uint256 indexed botId, address indexed trader);
    event PerformanceReported(uint256 indexed botId, int256 roiBps, uint16 winRateBps, uint64 periodEnd);

    modifier onlyCreator(uint256 botId) {
        require(botId < bots.length, "BotRegistry: no bot");
        require(bots[botId].creator == msg.sender, "BotRegistry: not creator");
        _;
    }

    function registerBot(string calldata name, string calldata strategyURI, uint16 feeBps)
        external
        returns (uint256 botId)
    {
        require(bytes(name).length > 0 && bytes(name).length <= 64, "BotRegistry: bad name");
        require(bytes(strategyURI).length <= 512, "BotRegistry: URI too long");
        require(feeBps <= MAX_FEE_BPS, "BotRegistry: fee too high");

        botId = bots.length;
        bots.push(Bot({
            creator: msg.sender,
            name: name,
            strategyURI: strategyURI,
            feeBps: feeBps,
            active: true,
            subscriberCount: 0,
            registeredAt: uint64(block.timestamp)
        }));

        emit BotRegistered(botId, msg.sender, name, feeBps, strategyURI);
    }

    function setActive(uint256 botId, bool active) external onlyCreator(botId) {
        bots[botId].active = active;
        emit BotStatusChanged(botId, active);
    }

    function setFee(uint256 botId, uint16 feeBps) external onlyCreator(botId) {
        require(feeBps <= MAX_FEE_BPS, "BotRegistry: fee too high");
        bots[botId].feeBps = feeBps;
        emit BotFeeChanged(botId, feeBps);
    }

    function subscribe(uint256 botId) external {
        require(botId < bots.length, "BotRegistry: no bot");
        require(bots[botId].active, "BotRegistry: inactive");
        require(!isSubscribed[botId][msg.sender], "BotRegistry: already subscribed");

        isSubscribed[botId][msg.sender] = true;
        bots[botId].subscriberCount += 1;
        emit Subscribed(botId, msg.sender);
    }

    function unsubscribe(uint256 botId) external {
        require(botId < bots.length, "BotRegistry: no bot");
        require(isSubscribed[botId][msg.sender], "BotRegistry: not subscribed");

        isSubscribed[botId][msg.sender] = false;
        bots[botId].subscriberCount -= 1;
        emit Unsubscribed(botId, msg.sender);
    }

    /// Creator-reported performance (UNVERIFIED — display with that caveat).
    function reportPerformance(uint256 botId, int256 roiBps, uint16 winRateBps, uint64 periodEnd)
        external
        onlyCreator(botId)
    {
        require(winRateBps <= 10_000, "BotRegistry: bad win rate");
        emit PerformanceReported(botId, roiBps, winRateBps, periodEnd);
    }

    function botCount() external view returns (uint256) {
        return bots.length;
    }

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
        )
    {
        require(botId < bots.length, "BotRegistry: no bot");
        Bot storage b = bots[botId];
        return (b.creator, b.name, b.strategyURI, b.feeBps, b.active, b.subscriberCount, b.registeredAt);
    }
}
