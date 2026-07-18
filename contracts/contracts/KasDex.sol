// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * KasDex — minimal multi-pool constant-product AMM (x * y = k).
 *
 * Uniswap-V2 mechanics in a single contract: pools are storage structs keyed
 * by the sorted token pair, LP shares are internal balances (not ERC20s).
 *
 * Reserve accounting measures actual balance deltas, so fee-on-transfer
 * tokens cannot desync reserves from holdings. Rebasing tokens remain
 * UNSUPPORTED: all pools share one contract-level balance per token, so a
 * rebase cannot be attributed to a single pool — do not list them.
 *
 * Pool creation is owner-gated for the curated MVP phase; permissionless
 * pools with fee tiers in the pool identity are future work.
 *
 * UNAUDITED — testnet only.
 */
contract KasDex is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    uint16 public constant MAX_FEE_BPS = 100; // 1%

    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalShares;
        uint16 feeBps; // 30 = 0.30%
        mapping(address => uint256) shares;
    }

    mapping(bytes32 => Pool) private pools;
    bytes32[] public poolIds;

    event PoolCreated(bytes32 indexed poolId, address indexed token0, address indexed token1, uint16 feeBps);
    event LiquidityAdded(bytes32 indexed poolId, address indexed provider, uint256 amount0, uint256 amount1, uint256 shares);
    event LiquidityRemoved(bytes32 indexed poolId, address indexed provider, uint256 amount0, uint256 amount1, uint256 shares);
    event Swap(bytes32 indexed poolId, address indexed trader, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor() Ownable(msg.sender) {}

    modifier ensure(uint256 deadline) {
        require(block.timestamp <= deadline, "KasDex: expired");
        _;
    }

    // ---------------------------------------------------------------
    // Pool identity
    // ---------------------------------------------------------------

    function sortTokens(address tokenA, address tokenB) public pure returns (address token0, address token1) {
        require(tokenA != tokenB, "KasDex: identical tokens");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "KasDex: zero address");
    }

    function poolIdFor(address tokenA, address tokenB) public pure returns (bytes32) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        return keccak256(abi.encodePacked(token0, token1));
    }

    // ---------------------------------------------------------------
    // Pool lifecycle
    // ---------------------------------------------------------------

    function createPool(address tokenA, address tokenB, uint16 feeBps) external onlyOwner returns (bytes32 poolId) {
        require(feeBps <= MAX_FEE_BPS, "KasDex: fee too high");
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        poolId = keccak256(abi.encodePacked(token0, token1));

        Pool storage pool = pools[poolId];
        require(pool.token0 == address(0), "KasDex: pool exists");

        pool.token0 = token0;
        pool.token1 = token1;
        pool.feeBps = feeBps;
        poolIds.push(poolId);

        emit PoolCreated(poolId, token0, token1, feeBps);
    }

    /**
     * Adds liquidity at the current pool ratio. Desired amounts are upper
     * bounds: the over-supplied side is trimmed to the proportional amount
     * (nothing is silently donated). Shares are minted from the amounts the
     * contract actually received.
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 minShares,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 sharesMinted) {
        bytes32 poolId = poolIdFor(tokenA, tokenB);
        Pool storage pool = pools[poolId];
        require(pool.token0 != address(0), "KasDex: no pool");

        (uint256 amount0Desired, uint256 amount1Desired) = tokenA == pool.token0
            ? (amountADesired, amountBDesired)
            : (amountBDesired, amountADesired);
        require(amount0Desired > 0 && amount1Desired > 0, "KasDex: zero amounts");

        // trim the over-supplied side to the pool ratio
        uint256 amount0 = amount0Desired;
        uint256 amount1 = amount1Desired;
        if (pool.totalShares != 0) {
            uint256 amount1Optimal = (amount0Desired * pool.reserve1) / pool.reserve0;
            if (amount1Optimal <= amount1Desired) {
                amount1 = amount1Optimal;
            } else {
                amount0 = (amount1Desired * pool.reserve0) / pool.reserve1;
            }
            require(amount0 > 0 && amount1 > 0, "KasDex: amounts too small");
        }

        // measure what actually arrives (fee-on-transfer safe)
        uint256 received0 = _pull(pool.token0, amount0);
        uint256 received1 = _pull(pool.token1, amount1);

        if (pool.totalShares == 0) {
            sharesMinted = Math.sqrt(received0 * received1);
            require(sharesMinted > MINIMUM_LIQUIDITY, "KasDex: liquidity too low");
            // permanently lock the first MINIMUM_LIQUIDITY shares (inflation-attack guard)
            sharesMinted -= MINIMUM_LIQUIDITY;
            pool.shares[address(0)] = MINIMUM_LIQUIDITY;
            pool.totalShares = MINIMUM_LIQUIDITY;
        } else {
            sharesMinted = Math.min(
                (received0 * pool.totalShares) / pool.reserve0,
                (received1 * pool.totalShares) / pool.reserve1
            );
        }
        require(sharesMinted >= minShares && sharesMinted > 0, "KasDex: insufficient shares");

        pool.reserve0 += received0;
        pool.reserve1 += received1;
        pool.totalShares += sharesMinted;
        pool.shares[msg.sender] += sharesMinted;

        emit LiquidityAdded(poolId, msg.sender, received0, received1, sharesMinted);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 sharesToBurn,
        uint256 min0,
        uint256 min1,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amount0, uint256 amount1) {
        bytes32 poolId = poolIdFor(tokenA, tokenB);
        Pool storage pool = pools[poolId];
        require(pool.shares[msg.sender] >= sharesToBurn && sharesToBurn > 0, "KasDex: insufficient shares");

        amount0 = (sharesToBurn * pool.reserve0) / pool.totalShares;
        amount1 = (sharesToBurn * pool.reserve1) / pool.totalShares;
        require(amount0 > 0 && amount1 > 0, "KasDex: burn too small");
        require(amount0 >= min0 && amount1 >= min1, "KasDex: slippage");

        pool.shares[msg.sender] -= sharesToBurn;
        pool.totalShares -= sharesToBurn;
        pool.reserve0 -= amount0;
        pool.reserve1 -= amount1;

        IERC20(pool.token0).safeTransfer(msg.sender, amount0);
        IERC20(pool.token1).safeTransfer(msg.sender, amount1);

        emit LiquidityRemoved(poolId, msg.sender, amount0, amount1, sharesToBurn);
    }

    // ---------------------------------------------------------------
    // Swaps
    // ---------------------------------------------------------------

    /// Quote against current reserves. Assumes the nominal amount arrives in
    /// full; for fee-on-transfer tokens the executed price uses the received
    /// amount, so quote with the post-fee value.
    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256 amountOut) {
        bytes32 poolId = poolIdFor(tokenIn, tokenOut);
        Pool storage pool = pools[poolId];
        require(pool.token0 != address(0), "KasDex: no pool");
        return _amountOut(pool, tokenIn, amountIn);
    }

    function _amountOut(Pool storage pool, address tokenIn, uint256 amountIn) private view returns (uint256 amountOut) {
        require(pool.reserve0 > 0 && pool.reserve1 > 0, "KasDex: no liquidity");

        (uint256 reserveIn, uint256 reserveOut) = tokenIn == pool.token0
            ? (pool.reserve0, pool.reserve1)
            : (pool.reserve1, pool.reserve0);

        uint256 amountInWithFee = amountIn * (10_000 - pool.feeBps);
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 10_000 + amountInWithFee);
    }

    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountOut) {
        require(amountIn > 0, "KasDex: zero amount");
        bytes32 poolId = poolIdFor(tokenIn, tokenOut);
        Pool storage pool = pools[poolId];
        require(pool.token0 != address(0), "KasDex: no pool");

        // pull first, price what actually arrived (fee-on-transfer safe)
        uint256 received = _pull(tokenIn, amountIn);
        amountOut = _amountOut(pool, tokenIn, received);
        require(amountOut > 0, "KasDex: zero output");
        require(amountOut >= minAmountOut, "KasDex: slippage");

        if (tokenIn == pool.token0) {
            pool.reserve0 += received;
            pool.reserve1 -= amountOut;
        } else {
            pool.reserve1 += received;
            pool.reserve0 -= amountOut;
        }

        IERC20(tokenOut).safeTransfer(to, amountOut);

        emit Swap(poolId, msg.sender, tokenIn, received, amountOut);
    }

    // ---------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------

    /// Transfers `amount` in from the caller and returns the balance delta
    /// the contract actually received.
    function _pull(address token, uint256 amount) private returns (uint256 received) {
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "KasDex: nothing received");
    }

    // ---------------------------------------------------------------
    // Views for the indexer / frontend
    // ---------------------------------------------------------------

    function poolCount() external view returns (uint256) {
        return poolIds.length;
    }

    function getPool(address tokenA, address tokenB)
        external
        view
        returns (address token0, address token1, uint256 reserve0, uint256 reserve1, uint256 totalShares, uint16 feeBps)
    {
        Pool storage pool = pools[poolIdFor(tokenA, tokenB)];
        require(pool.token0 != address(0), "KasDex: no pool");
        return (pool.token0, pool.token1, pool.reserve0, pool.reserve1, pool.totalShares, pool.feeBps);
    }

    function getPoolById(bytes32 poolId)
        external
        view
        returns (address token0, address token1, uint256 reserve0, uint256 reserve1, uint256 totalShares, uint16 feeBps)
    {
        Pool storage pool = pools[poolId];
        require(pool.token0 != address(0), "KasDex: no pool");
        return (pool.token0, pool.token1, pool.reserve0, pool.reserve1, pool.totalShares, pool.feeBps);
    }

    function sharesOf(address tokenA, address tokenB, address provider) external view returns (uint256) {
        return pools[poolIdFor(tokenA, tokenB)].shares[provider];
    }
}
