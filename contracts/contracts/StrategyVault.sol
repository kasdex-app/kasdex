// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IKasDex {
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external returns (uint256 amountOut);
}

/**
 * StrategyVault — non-custodial vault binding depositor funds to one bot.
 *
 * The core promise: the bot's operator can ONLY trade the vault's funds
 * through KasDex between allowlisted tokens, with the vault itself as the
 * recipient. There is no code path by which the operator or creator can
 * move funds anywhere else. Depositors can withdraw pro-rata at any time.
 *
 * Accounting: deposits are made in `baseToken` and are only accepted while
 * the vault is FLAT (holding nothing but baseToken), so share pricing needs
 * no oracle. The creator's performance fee applies exclusively to realized
 * baseToken profit above the depositor's own cost basis at withdrawal —
 * unrealized positions exit fee-free pro-rata (conservative: undercharges,
 * never overcharges).
 *
 * Known, documented risk: a malicious operator can burn value through bad
 * trades (that is inherent strategy risk); they cannot steal it. Trade-size
 * caps and cooldowns are future work. UNAUDITED — testnet only.
 */
contract StrategyVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_SHARES = 1_000;

    IKasDex public immutable dex;
    uint256 public immutable botId;
    address public immutable creator;
    address public immutable baseToken;
    uint16 public immutable performanceFeeBps;
    /// max share of the vault's tokenIn balance a single trade may spend
    uint16 public immutable maxTradeBps;
    /// minimum seconds between trades
    uint32 public immutable tradeCooldown;

    address public operator; // the bot process key; creator-managed
    address[] public allowedTokens; // includes baseToken
    mapping(address => bool) public isAllowed;
    uint64 public lastTradeAt;

    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;
    mapping(address => uint256) public costBasisOf; // baseToken units

    event Deposited(address indexed account, uint256 amount, uint256 shares);
    event Withdrawn(address indexed account, uint256 shares, uint256 baseAmount, uint256 fee);
    event TradeExecuted(address indexed operator, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event OperatorChanged(address indexed operator);

    modifier onlyOperator() {
        require(msg.sender == operator, "Vault: not operator");
        _;
    }

    constructor(
        address dex_,
        uint256 botId_,
        address creator_,
        address baseToken_,
        address[] memory allowedTokens_,
        uint16 performanceFeeBps_,
        uint16 maxTradeBps_,
        uint32 tradeCooldown_
    ) {
        require(performanceFeeBps_ <= 3_000, "Vault: fee too high");
        require(maxTradeBps_ >= 100 && maxTradeBps_ <= 5_000, "Vault: trade cap out of range"); // 1%..50%
        require(tradeCooldown_ <= 1 days, "Vault: cooldown too long");
        dex = IKasDex(dex_);
        botId = botId_;
        creator = creator_;
        operator = creator_;
        baseToken = baseToken_;
        performanceFeeBps = performanceFeeBps_;
        maxTradeBps = maxTradeBps_;
        tradeCooldown = tradeCooldown_;

        isAllowed[baseToken_] = true;
        allowedTokens.push(baseToken_);
        for (uint256 i = 0; i < allowedTokens_.length; i++) {
            address t = allowedTokens_[i];
            if (!isAllowed[t]) {
                isAllowed[t] = true;
                allowedTokens.push(t);
            }
        }
    }

    // ---------------------------------------------------------------
    // Depositor side
    // ---------------------------------------------------------------

    /// True when the vault holds nothing but baseToken.
    function isFlat() public view returns (bool) {
        uint256 len = allowedTokens.length;
        for (uint256 i = 0; i < len; i++) {
            address t = allowedTokens[i];
            if (t != baseToken && IERC20(t).balanceOf(address(this)) != 0) return false;
        }
        return true;
    }

    function deposit(uint256 amount) external nonReentrant returns (uint256 minted) {
        require(amount > 0, "Vault: zero amount");
        require(isFlat(), "Vault: deposits open only between trading rounds");

        uint256 baseBal = IERC20(baseToken).balanceOf(address(this));

        uint256 balBefore = IERC20(baseToken).balanceOf(address(this));
        IERC20(baseToken).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(baseToken).balanceOf(address(this)) - balBefore;

        if (totalShares == 0) {
            minted = received;
            require(minted > MINIMUM_SHARES, "Vault: deposit too small");
            minted -= MINIMUM_SHARES; // inflation-attack guard
            sharesOf[address(0)] = MINIMUM_SHARES;
            totalShares = MINIMUM_SHARES;
        } else {
            minted = (received * totalShares) / baseBal;
        }
        require(minted > 0, "Vault: zero shares");

        totalShares += minted;
        sharesOf[msg.sender] += minted;
        costBasisOf[msg.sender] += received;

        emit Deposited(msg.sender, received, minted);
    }

    /**
     * Withdraw pro-rata. Base-token profit above the caller's cost basis
     * pays the creator's performance fee; non-base holdings exit fee-free.
     */
    function withdraw(uint256 shares) external nonReentrant returns (uint256 baseOut) {
        uint256 userShares = sharesOf[msg.sender];
        require(shares > 0 && shares <= userShares, "Vault: bad shares");

        uint256 costPortion = (costBasisOf[msg.sender] * shares) / userShares;

        // effects first
        sharesOf[msg.sender] = userShares - shares;
        costBasisOf[msg.sender] -= costPortion;
        uint256 sharesTotal = totalShares;
        totalShares = sharesTotal - shares;

        // base token: pro-rata value, fee on profit above cost basis
        uint256 baseBal = IERC20(baseToken).balanceOf(address(this));
        uint256 baseValue = (baseBal * shares) / sharesTotal;
        uint256 fee = 0;
        if (baseValue > costPortion) {
            fee = ((baseValue - costPortion) * performanceFeeBps) / 10_000;
        }
        baseOut = baseValue - fee;

        if (fee > 0) IERC20(baseToken).safeTransfer(creator, fee);
        if (baseOut > 0) IERC20(baseToken).safeTransfer(msg.sender, baseOut);

        // any open positions: pro-rata, no fee
        uint256 len = allowedTokens.length;
        for (uint256 i = 0; i < len; i++) {
            address t = allowedTokens[i];
            if (t == baseToken) continue;
            uint256 bal = IERC20(t).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 cut = (bal * shares) / sharesTotal;
            if (cut > 0) IERC20(t).safeTransfer(msg.sender, cut);
        }

        emit Withdrawn(msg.sender, shares, baseOut, fee);
    }

    // ---------------------------------------------------------------
    // Bot side — the ONLY way vault funds move besides withdrawals
    // ---------------------------------------------------------------

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    ) external onlyOperator nonReentrant returns (uint256 amountOut) {
        require(isAllowed[tokenIn] && isAllowed[tokenOut], "Vault: token not allowed");

        // Trades INTO the base token de-risk the vault and are always free.
        // Risk-increasing trades are size-capped and rate-limited so a rogue
        // operator cannot burn TVL through outsized slippage or churn.
        if (tokenOut != baseToken) {
            require(
                amountIn <= (IERC20(tokenIn).balanceOf(address(this)) * maxTradeBps) / 10_000,
                "Vault: trade exceeds cap"
            );
            require(block.timestamp >= lastTradeAt + tradeCooldown, "Vault: cooldown");
            lastTradeAt = uint64(block.timestamp);
        }

        IERC20(tokenIn).forceApprove(address(dex), amountIn);
        amountOut = dex.swapExactIn(tokenIn, tokenOut, amountIn, minAmountOut, address(this), deadline);

        emit TradeExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    function setOperator(address newOperator) external {
        require(msg.sender == creator, "Vault: not creator");
        require(newOperator != address(0), "Vault: zero operator");
        operator = newOperator;
        emit OperatorChanged(newOperator);
    }

    // ---------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------

    function allowedTokenCount() external view returns (uint256) {
        return allowedTokens.length;
    }

    function holdings() external view returns (address[] memory tokens, uint256[] memory balances) {
        tokens = allowedTokens;
        uint256 len = tokens.length;
        balances = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            balances[i] = IERC20(tokens[i]).balanceOf(address(this));
        }
    }
}
