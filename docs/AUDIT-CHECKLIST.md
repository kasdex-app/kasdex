# Audit Checklist — KasDex contracts

Status snapshot for a future professional audit. Everything here runs on
Igra Galleon testnet only; nothing is mainnet-ready until an external audit
clears it. Test suite: **34 passing** (`contracts/npm test`) — includes
invariant/property tests and attack simulations (test/invariants.test.js).
Static analysis: **Slither** run 2026-07-16, no high/medium findings in our
code. See MAINNET-ROADMAP.md for the path to mainnet and THREAT-MODEL.md for
the structured threat enumeration.

## Contracts in scope

| Contract | Purpose | Risk level |
|----------|---------|-----------|
| `KasDex.sol` | multi-pool constant-product AMM | high (holds all pool funds) |
| `StrategyVault.sol` | non-custodial per-bot vault | high (holds depositor funds) |
| `VaultFactory.sol` | vault deployment + creator gating | medium |
| `BotRegistry.sol` | bot metadata + subscriptions | low (never holds funds) |
| `WKAS.sol` | WETH9-style native wrapper | low (battle-tested pattern) |
| `MockERC20.sol`, `FeeOnTransferMock.sol` | testnet-only tokens | n/a (never deploy to mainnet) |

## Mitigations already in place (each has a regression test)

- **AMM reserves measured from balance deltas** — fee-on-transfer tokens
  cannot desync reserves from holdings (found by adversarial review).
- **Off-ratio liquidity trimmed, not donated** (found by adversarial review).
- Zero-output swaps revert; deadlines on all mutating calls; reentrancy
  guards; MINIMUM_LIQUIDITY / MINIMUM_SHARES inflation-attack locks.
- Pool creation owner-gated for the curated phase (kills fee-squatting and
  junk-pool spam until fee-tiered permissionless pools are designed).
- **Vault operator containment**: `executeSwap` is the only fund-moving path
  besides depositor withdrawals; tokens allowlisted; recipient is always the
  vault itself.
- **Vault trade caps**: risk-increasing trades limited to `maxTradeBps`
  (1–50%, immutable) with a cooldown (≤ 1 day); trades INTO the base token
  are always free so depositors are never trapped. Verified live on Galleon:
  a 30% trade against a 25% cap reverted on-chain.
- **Fee integrity**: performance fee snapshotted at vault creation (creator
  cannot raise it on existing depositors); fee applies only to realized
  base-token profit above the depositor's own cost basis.

## Known accepted limitations (documented in code)

1. **Rebasing tokens unsupported** — KasDex pools share one contract-level
   balance per token, so a rebase cannot be attributed per pool. Mainnet
   must enforce a token allowlist or per-pair pool contracts.
2. **Operator slippage residual risk** — within the trade cap, an operator
   colluding with a sandwich attacker can still leak value per trade
   (bounded by cap × pool depth). Full fix needs TWAP/oracle pricing checks;
   the cap + cooldown bound the bleed rate.
3. **Vault NAV is oracle-free by design** — deposits only while flat. A
   depositor who withdraws mid-position gets pro-rata tokens and may pay no
   fee on unrealized gains (deliberately depositor-favoring).
4. **Cost basis is per-account, average-style** — transferring shares is not
   supported (shares are non-transferable internal balances), which keeps
   basis accounting sound.
5. **`getAmountOut` quotes and swap execution read the same reserves** — a
   vault-level "max deviation from quote" check would be vacuous; slippage
   protection relies on caller-supplied `minAmountOut`.

## Open items before mainnet

- [ ] External audit of KasDex + StrategyVault (at minimum)
- [ ] Decide permissionless-pool design (fee tier in pool identity)
- [ ] TWAP oracle for vault trade sanity checks
- [ ] Token allowlist policy for pools (rebasing/fee-on-transfer classes)
- [ ] Emergency-pause discussion (currently NO admin pause by design —
      trade-off between trustlessness and incident response; document choice)
- [ ] Gas-griefing review of unbounded loops (`allowedTokens` in vault
      withdraw/isFlat — bounded by creation-time list; factory enforces no cap
      today)
- [ ] Legal review of the fee model (performance fee on non-custodial vaults)
- [ ] Galleon → Igra mainnet migration plan (chain 38836 → 38833)
