# Static Analysis — Slither

Tool: **Slither** (Crytic/Trail of Bits), 57 detectors, run against the full
Hardhat project at commit `800f2e3`. Raw output: `slither-report.json`.

## Summary for our contracts (excluding OpenZeppelin + pragma noise)

| Impact | Count | Disposition |
|--------|-------|-------------|
| High | 0 | — |
| Medium | 3 | all reviewed — false positives / intentional (below) |
| Low | 11 | style/gas informational; one gas item fixed |
| Informational | 4 | pragma versions, naming — no action |

No high-severity findings. The three Medium findings are documented below with
our reasoning so the auditor can confirm rather than re-derive.

## Medium findings — reviewed, all safe

### M1 & M2 — `incorrect-equality` (strict `== 0`)
- **M1:** `StrategyVault.deposit` uses `totalShares == 0` (line ~129).
- **M2:** `StrategyVault.withdraw` uses `bal == 0` (line ~181).

Slither's `incorrect-equality` detector flags any strict `==`, because strict
equality is dangerous against values an attacker can nudge (e.g. `balance ==`
a specific amount, or `block.timestamp ==`). Neither instance is that case:

- `totalShares == 0` is the canonical "first deposit?" check (identical to
  Uniswap V2's `totalSupply == 0`). After the first deposit, `totalShares` is
  permanently ≥ `MINIMUM_SHARES` (1000), which is locked to `address(0)` and
  can never be withdrawn (address(0) cannot call `withdraw`). So the equality
  is only ever true exactly once, before any real deposit. **Correct.**
- `bal == 0` skips tokens the vault holds none of, in the pro-rata exit loop.
  `balanceOf` returns an exact value; skipping exactly-zero balances is the
  intended behavior. **Correct.**

Verdict: **false positives.** No code change (contorting correct code to
silence a heuristic would be worse than documenting it).

### M3 — `unused-return` in `VaultFactory.createVault`
`(creator, , , feeBps, active, , ) = registry.getBot(botId)` — the tuple
destructuring ignores `name`, `strategyURI`, `subscriberCount`, `registeredAt`.

Slither flags the ignored return components. This is **intentional**: the
factory only needs `creator` (authorization), `feeBps` (fee snapshot), and
`active` (guard). The other fields are irrelevant to vault creation. No value
from an external *call* is being silently dropped in a way that affects safety.

Verdict: **intentional / safe.** An auditor may prefer an explicit
`// slither-disable-next-line unused-return` annotation; we left the code
unchanged and document it here.

## Low findings (informational)

The 11 Low items are standard informational hints:
- `low-level-call` in `WKAS.withdraw` — the unavoidable WETH native-send idiom
  (CEI ordering already applied: burn → emit → call → require success).
- `missing-inheritance` — `KasDex`/`BotRegistry` could formally `is IKasDex` /
  `is IBotRegistry`; cosmetic, interfaces already match structurally.
- `cache-array-length` — **fixed** (cached `allowedTokens.length` in the vault
  loops).
- Various OpenZeppelin-internal `too-many-digits` / assembly notes — library
  code, out of scope.

## Not yet run (recommended additional passes)

- **Fuzzing** (Foundry invariant tests / Echidna) — needs Foundry toolchain.
- **Aderyn** (second static analyzer) — cross-check Slither.
- **Manual economic review** of flash-loan and sandwich paths — this is the
  core value of the paid audit and is deliberately left to the auditor.
