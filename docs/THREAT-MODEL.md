# Threat Model — KasDex

Written 2026-07-16. A structured enumeration of who attacks this system, how,
and what stops them. This is an input to the external audit, not a substitute
for it. Testnet-only until audited.

## Assets at risk

1. **Pool reserves** in KasDex (all LPs' liquidity)
2. **Vault deposits** in each StrategyVault (depositors' funds)
3. **Protocol integrity** — correct prices, honest bot track records
4. **Reputation** — one exploit ends the project

## Actors

| Actor | Trust level | Capability |
|-------|-------------|-----------|
| LP | untrusted | add/remove liquidity, swap |
| Trader | untrusted | swap, deposit/withdraw vault |
| Bot creator | semi-trusted (by their depositors) | register bot, create vault, operate trades |
| Vault operator | semi-trusted | `executeSwap` within caps |
| DEX owner | privileged | `createPool` (curated phase) |
| External attacker | hostile | anything on-chain, flash loans, MEV |

## Threats and mitigations

### T1 — Reserve/balance desync (fee-on-transfer, rebasing)
- **Vector:** token whose `transfer` moves ≠ requested amount.
- **Mitigation:** reserves measured by balance delta (`_pull`); rebasing
  unsupported by design; pool creation owner-gated. ✅ tested.
- **Residual:** owner must never list a rebasing token. → audit + allowlist.

### T2 — Vault operator theft
- **Vector:** operator tries to move funds out of the vault.
- **Mitigation:** `executeSwap` is the ONLY fund-moving path; trades only
  through KasDex, only allowlisted tokens, recipient always the vault. ✅ tested.
- **Residual:** operator can still *lose* funds via bad trades (inherent),
  bounded by trade cap + cooldown. Documented, not eliminated.

### T3 — Operator + sandwich collusion
- **Vector:** operator makes a deliberately bad trade into a pool an
  accomplice sandwiches, leaking value per trade.
- **Mitigation:** per-trade size cap (1–50%) + cooldown bound the bleed rate.
- **Residual:** NOT fully solved. Real fix = TWAP/oracle sanity check on
  `minAmountOut`. → flagged for audit; a top priority before high TVL.

### T4 — Inflation / first-depositor attack
- **Vector:** attacker is first LP/depositor, donates to skew share price,
  steals rounding from the next user.
- **Mitigation:** MINIMUM_LIQUIDITY / MINIMUM_SHARES locked on first mint. ✅ tested.

### T5 — Reentrancy
- **Vector:** malicious token re-enters mid-swap.
- **Mitigation:** `nonReentrant` on all mutating external fns; checks-effects-
  interactions ordering; WKAS emits before external call. ✅ tested.
- **Residual:** ERC-777/hook tokens — mitigated by owner-gated pools; audit.

### T6 — Deadline / stale-tx MEV
- **Vector:** a tx sits in mempool, executes later at a bad price.
- **Mitigation:** deadline param on all mutating calls; frontend uses CHAIN
  time (local clock drift lesson). ✅ tested.

### T7 — Dust / zero-output rounding
- **Vector:** tiny inputs round output to 0, consuming input for nothing.
- **Mitigation:** swaps require `amountOut > 0`; burns require nonzero. ✅ tested.

### T8 — Governance / privileged-key compromise
- **Vector:** DEX owner key stolen → attacker lists malicious pools.
- **Mitigation (current):** single owner, testnet only.
- **Residual:** MAINNET REQUIRES multi-sig or timelock on the owner role. → Phase C.

### T9 — Indexer / off-chain trust
- **Vector:** the backend indexer misreports performance or pool state.
- **Mitigation:** indexer is READ-ONLY; all truth is on-chain; users can
  verify against the chain (addresses published in the About page).
- **Residual:** UI could be phished/spoofed — standard web risk; use the
  published contract addresses.

### T10 — Economic / flash-loan manipulation
- **Vector:** flash-loan a huge swap to move price, exploit a dependent calc.
- **Mitigation:** constant-product math is manipulation-resistant for swaps
  themselves; vaults don't price off spot without operator action.
- **Residual:** full flash-loan attack modeling is EXACTLY what a paid audit
  does. Not something to self-certify. → Phase B.

## Explicitly accepted (documented) limitations

- Rebasing tokens unsupported.
- Operator can lose (not steal) funds — inherent strategy risk.
- No admin pause (trustlessness vs incident-response tradeoff) — revisit at Phase C.
- Oracle-free vault NAV — deposits only when flat.

## Top pre-mainnet priorities (in order)

1. External audit (T10, T3, T5 need professional eyes)
2. TWAP/oracle sanity check for vault trades (T3)
3. Multi-sig/timelock on owner role (T8)
4. Token allowlist policy for pools (T1)
5. Bug bounty before scaling TVL
