# KasDex — Architecture (for auditors)

How the five in-scope contracts fit together, and the security-relevant
mechanics of each. Read alongside THREAT-MODEL.md.

## System overview

```
          users (wallets)
             │  swap / addLiquidity / removeLiquidity
             ▼
        ┌─────────┐   getAmountOut, swapExactIn (x*y=k, balance-delta reserves)
        │ KasDex  │◄──────────────────────────────────────────┐
        └─────────┘                                            │ executeSwap
             ▲                                                 │ (allowlisted
             │ creates pools (owner-gated)                     │  tokens only,
             │                                                 │  recipient = vault)
        ┌────────────┐  registerBot/subscribe    ┌──────────────────┐
        │ BotRegistry│◄──────────users──────────►│  StrategyVault   │◄─ depositors
        └────────────┘                           └──────────────────┘   deposit/withdraw
             ▲  getBot (creator, fee, active)          ▲
             │                                         │ new StrategyVault(...)
             │           ┌──────────────┐              │
             └───────────│ VaultFactory │──────────────┘
                         └──────────────┘   one vault per bot, creator-gated

  WKAS: wraps native iKAS/KAS ⇄ ERC20 so it can be pooled/traded/deposited.
```

## KasDex.sol — the AMM

Multi-pool constant-product (x·y=k) AMM in a single contract. Pools are
storage structs keyed by `keccak256(sortedToken0, sortedToken1)`. LP positions
are internal share balances (not ERC20s).

Security-relevant mechanics:
- **Balance-delta reserve accounting** (`_pull`): reserves are credited by the
  measured `balanceOf` delta, not the requested amount — fee-on-transfer tokens
  cannot desync reserves from holdings. (Found & fixed in internal review.)
- **Off-ratio liquidity trimmed**, never donated: `addLiquidity` computes the
  optimal proportional amount and only pulls that.
- **Inflation guard:** `MINIMUM_LIQUIDITY` (1000) locked to `address(0)` on
  first mint.
- **Swap safety:** `nonReentrant`, deadline, `amountOut > 0` required,
  caller-supplied `minAmountOut` slippage bound.
- **Owner-gated `createPool`** (curated phase); fee is set at pool creation,
  `feeBps ≤ 100` (1%).
- Reserves are tracked in storage (not read from `balanceOf` at swap time),
  so direct token donations do not affect pricing.

## StrategyVault.sol — the non-custodial vault

One vault per bot. Depositors deposit `baseToken`; the bot's operator trades
those funds — but *only* through KasDex, *only* between allowlisted tokens,
*always* with the vault itself as recipient.

Security-relevant mechanics:
- **Fund containment:** `executeSwap` is the ONLY fund-moving function besides
  depositor `withdraw`. It has no recipient parameter — output is hardcoded to
  `address(this)`. There is no transfer/rescue/sweep function.
- **Trade limits:** risk-increasing trades (tokenOut ≠ base) are capped at
  `maxTradeBps` (1–50%, immutable) of the current tokenIn balance and
  rate-limited by `tradeCooldown` (≤ 1 day). Trades INTO the base token
  (de-risking) are always free — depositors can never be trapped.
- **Oracle-free NAV:** deposits are only accepted while the vault `isFlat()`
  (holds nothing but base), so share pricing needs no price feed.
- **Fee logic:** performance fee (`performanceFeeBps`, snapshotted from the
  registry at creation, ≤ 30%) applies ONLY to realized base-token profit above
  the withdrawing depositor's own cost basis. Losses and open positions exit
  fee-free. Fee can never exceed realized profit.
- **Inflation guard:** `MINIMUM_SHARES` (1000) locked on first deposit.
- **Reentrancy:** `nonReentrant` on deposit/withdraw/executeSwap.
- Operator is creator-managed (`setOperator`, creator-only).

⚠️ Auditor note — the main residual risk (T3 in THREAT-MODEL): an operator
colluding with a sandwicher can leak value per trade within the cap. We have
no TWAP/oracle check on `minAmountOut`. This is our top question.

## VaultFactory.sol

Deploys one `StrategyVault` per registered bot. Creator-gated: only the bot's
registered creator (read from `BotRegistry.getBot`) can create its vault, once.
The performance fee is snapshotted from the registry at creation so it can't be
raised on existing depositors later.

Note: `createVault` intentionally destructures only `creator/feeBps/active` from
`getBot` and ignores the rest — see STATIC-ANALYSIS.md (Slither unused-return,
intentional).

## BotRegistry.sol

Holds bot metadata (name, strategy URI, fee, active flag) and subscriptions.
Never holds funds. `registerBot` bounds name (1–64 bytes), strategyURI (≤ 512
bytes), fee (≤ 30%). Subscribe/unsubscribe track a counter. Performance is
creator-reported here and clearly labeled as such in the UI; the *verified*
performance shown for vaults is computed off-chain from on-chain vault trades.

## WKAS.sol

Standard WETH9 pattern: `deposit()` payable mints, `withdraw()` burns then
sends native. Burns before the external call (CEI); emits before the call.
The single low-level `.call` for native transfer is the unavoidable WETH idiom.

## Trust model summary

| Role | Trusted for | NOT trusted for |
|------|-------------|-----------------|
| DEX owner | curating pool listings | holding user funds (can't) |
| Bot creator | strategy quality | moving depositor funds out (can't) |
| Vault operator | trading skill | withdrawing funds (can't), unbounded trades (capped) |
| Indexer/backend | display convenience | anything on-chain (read-only) |
| Users | nothing — adversarial assumed | — |
