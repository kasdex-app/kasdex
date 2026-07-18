# KasDex — Audit Package

This directory is the self-contained package for a professional security
audit of the KasDex smart contracts. It is designed so an auditor can scope,
quote, and begin quickly. Everything here is public and testnet-only; no real
funds are yet at stake.

- **Repository:** https://github.com/kasdex-app/kasdex
- **Commit at package time:** `800f2e3` (audit against the latest `main` or a
  tagged freeze commit — coordinate before engagement)
- **Language / compiler:** Solidity `0.8.28`, optimizer on (200 runs)
- **Dependencies:** OpenZeppelin Contracts `^5.1.0` (assume audited; out of scope)
- **Target chains:** Igra Galleon testnet (chain 38836) now; Igra mainnet
  (chain 38833) is the eventual target — standard EVM, no exotic opcodes.
- **Contact:** dev@kasdex.app

## In scope

| Contract | Lines (code) | Purpose | Holds funds? |
|----------|--------------|---------|--------------|
| `KasDex.sol` | 284 (192) | Multi-pool constant-product AMM | **Yes** — all pool reserves |
| `StrategyVault.sol` | 243 (166) | Non-custodial per-bot trading vault | **Yes** — depositor funds |
| `VaultFactory.sol` | 67 (48) | Deploys one vault per registered bot | No |
| `BotRegistry.sol` | 125 (96) | Bot metadata + subscriptions | No |
| `WKAS.sol` | 32 (20) | WETH9-style native wrapper | Transient (wrap/unwrap) |

**Total in-scope: ~522 code lines across 5 contracts.** Compact by design.

## Out of scope

- `MockERC20.sol`, `FeeOnTransferMock.sol` — test-only tokens, never deployed
  to mainnet.
- OpenZeppelin library code (SafeERC20, ReentrancyGuard, Ownable, Math, ERC20).
- Frontend, backend indexer, Python bot kit — off-chain, cannot move funds
  except through the audited contracts via a user's own signed transactions.

## Package contents

| File | What it is |
|------|-----------|
| `README.md` | this — scope, setup, contact |
| `ARCHITECTURE.md` | system overview + contract-by-contract walkthrough |
| `STATIC-ANALYSIS.md` | Slither results and our disposition of every finding |
| `slither-report.json` | raw Slither JSON output |
| `deployed-addresses.json` | current Galleon testnet deployment |
| `../docs/THREAT-MODEL.md` | structured threat enumeration (T1–T10) |
| `../docs/AUDIT-CHECKLIST.md` | mitigations + accepted limitations |
| `../docs/MAINNET-ROADMAP.md` | our understanding of the path to mainnet |

## Build & test (reproduce locally)

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat test          # 34 tests: unit + invariants + attack simulations
```

Test files:
- `test/kasdex.test.js` — AMM unit tests
- `test/vault.test.js` — vault + factory unit tests
- `test/invariants.test.js` — property tests + attack simulations

## What we most want reviewed (auditor focus areas)

Ranked by our own risk assessment (see THREAT-MODEL.md for full detail):

1. **Operator + sandwich collusion (vault):** the trade cap + cooldown bound
   the bleed rate, but we have NO oracle/TWAP sanity check on `minAmountOut`.
   Is the residual risk acceptable, and what's the right mitigation?
2. **AMM economic / flash-loan attack surface** on `KasDex` swaps and LP math.
3. **Vault accounting** — share pricing, cost-basis fee logic, the flat-only
   deposit invariant, pro-rata exit with open positions.
4. **Fund-containment proof for the vault** — confirm `executeSwap` is truly
   the only path funds can leave except pro-rata withdrawals.
5. **Rounding / precision** across AMM and vault share math.

## Known accepted limitations (not defects — design choices)

- Rebasing tokens unsupported (pools share one balance per token).
- Vault operators can *lose* (not steal) funds — inherent strategy risk,
  bounded by trade cap + cooldown.
- No admin pause (trustlessness vs incident response) — open question for
  mainnet, input welcome.
- Pool creation is owner-gated for the curated phase.
