# KasDex — Contracts & Audit Package

KasDex is a DEX + open trading-bot marketplace on Kaspa's EVM layer-2
networks: a constant-product AMM, an on-chain bot registry, and non-custodial
strategy vaults where a bot can trade depositor funds but never withdraw them.

**This repository is the trust layer.** Everything a user, integrator, or
auditor needs to verify how KasDex handles funds is public here: the complete
smart-contract source, the full test suites, the audit package, and the
creator SDK. The application layer (web app, API, indexer) is closed source
and lives in a private repository.

## What's public and why

| Directory | Contents |
|-----------|----------|
| `contracts/` | All Solidity source (MIT), Hardhat config, deploy scripts, and the unit + attack-simulation + invariant test suites |
| `audit/` | Self-contained audit package: architecture, scope, static-analysis disposition, deployed addresses |
| `docs/` | Threat model, audit checklist, mainnet roadmap, chain reality-check |
| `bot-engine/operator_kit/` | The Python SDK bot creators use to run a strategy against their own vault (see its README) |

Every contract that can ever hold user funds is in this repo, byte-for-byte
what is deployed on-chain.

## The security story in one paragraph

The AMM measures reserves from actual balance deltas (fee-on-transfer safe),
locks the first LP shares against inflation attacks, trims off-ratio
liquidity instead of donating it, and requires a nonzero output and a
deadline on every swap. Strategy vaults are non-custodial by construction:
the operator's only capability is `executeSwap` through the DEX between
allowlisted tokens with the vault itself as recipient — there is no code
path to move funds elsewhere. Depositors exit pro-rata at any time, and the
creator's performance fee applies only to realized base-token profit above
each depositor's own cost basis. The invariant suite proves k never
decreases, no swap sequence yields a risk-free profit, and reserves always
match balances. **Still UNAUDITED — testnet only**; see `docs/THREAT-MODEL.md`
and `audit/` for the full account, including known limitations.

## Verify it yourself

```bash
cd contracts && npm install
npm test          # unit, attack-simulation and invariant suites
```

## Live deployment (Igra Galleon testnet, chain 38836)

Current addresses are in [`audit/deployed-addresses.json`](audit/deployed-addresses.json)
and [`contracts/deployments/galleon.json`](contracts/deployments/galleon.json).

## For bot creators

Register a strategy in the `BotRegistry`, create your vault via
`VaultFactory.createVault` (your fee is snapshotted and can never rise for
existing depositors), then drive it with `bot-engine/operator_kit/` — the
runner handles quoting, chain-time deadlines and slippage floors. Your track
record accrues on-chain where nobody can fake it.

## License & contact

Contract source is MIT (see `LICENSE`). The KasDex application (web app,
API, indexer, first-party strategies) is proprietary and not part of this
repository. Contact: dev@kasdex.app
