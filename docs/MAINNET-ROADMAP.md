# Mainnet Roadmap — the honest path from testnet to real money

Written overnight 2026-07-16 for review. This is the plan to turn KasDex
from a working testnet product into one that can safely hold real user funds.
Nothing here is a promise that it will succeed — it's the minimum responsible
path. Costs and timelines are researched, not guessed (sources at the bottom).

## The one-paragraph truth

KasDex is **feature-complete on testnet** and genuinely good. The gap to
mainnet is **not more features** — it's **security assurance**. The contracts
hold the money; if they have one exploitable bug, users lose everything and
the project dies. Every step below exists to drive that risk toward zero
before a single real dollar is at stake. This is weeks-to-months and
thousands of dollars, not a weekend. That is normal and correct.

## Phase A — Self-hardening (free, I can do most of this)

Goal: fix everything findable without paying anyone, so the paid audit finds
less and costs less.

- [x] Adversarial internal review (done 2026-07-15, findings fixed)
- [x] Invariant / property test suite + attack simulations (test/invariants.test.js,
      2026-07-16) — 34 tests total, all passing. Encodes k-monotonicity,
      no-risk-free-profit, accounting soundness, operator containment,
      never-trapped-depositor, fee-bounded-by-profit.
- [x] Static analysis: **Slither** run 2026-07-16 — analyzed 25 contracts,
      NO high/medium findings in our code. Only: OZ-library noise, an accepted
      WETH-pattern low-level call in WKAS, and a cache-array-length gas hint
      (fixed). Clean result.
- [x] Threat model document (THREAT-MODEL.md)
- [x] Gas review of the vault loops (cached array length, 2026-07-16)
- [ ] Fuzz testing (Foundry `forge test` fuzzing, or Echidna) — needs Foundry install
- [ ] Aderyn static analysis (second tool, cross-check)
- [ ] Freeze the contract code — no new features once audit prep starts

## Phase B — External audit (the real gate, costs money)

Researched 2026 pricing for a DeFi AMM + vault of this size:

| Route | Cost | Time | Notes |
|-------|------|------|-------|
| **CodeHawks First Flight** | prize pool < $20K (often $5–15K) | ~1 wk | Cheapest real option; newer auditors, lighter competition. Good FIRST pass for an early project like ours. |
| **Competitive contest** (Sherlock / Cantina / Immunefi) | ~$6.5K entry to $50K+ pool | 1–3 wks | Many eyes, pay-for-results. Good middle route. |
| **Boutique firm, fixed audit** | $20K–50K | 3–4 wks | AMM+vault w/ economic risk. A named firm's report is what gives users confidence. |
| **Tier-1 firm** | $50K–120K+ | 3–6 wks | Overkill until there's real TVL to justify it. |

**Realistic recommendation for us:** start with a **CodeHawks First Flight or
a small competitive contest ($5–15K)** after Phase A. If it comes back clean
and the project gets traction, do a boutique firm audit ($20–40K) before
scaling TVL. Budget **$60–120K total** across audit + remediation review if we
go the full route — but we do NOT need all of that to start; it scales with
how much money we're asking users to trust us with.

- [ ] Pick a route based on budget + traction
- [ ] Submit the frozen code + this repo's docs as the audit package
- [ ] Fix every finding, get a remediation review, publish the report

## Phase C — Mainnet deployment (irreversible, needs real KAS + your go-ahead)

- [ ] Legal review of the fee model + non-custodial vault design in your
      jurisdiction (a real lawyer, not me — money-transmitter rules vary)
- [ ] Acquire real KAS, bridge to Igra mainnet (chain **38833**, not the
      38836 testnet), for gas + seed liquidity
- [ ] Deploy audited, frozen contracts to Igra mainnet
- [ ] Multi-sig or timelock on any privileged role (the DEX owner key)
- [ ] Set up a bug bounty (Immunefi) so whitehats have a reason to report,
      not exploit
- [ ] Start with LOW caps / small seed liquidity; scale as confidence grows

## Phase D — Growth (the fun part, after it's safe)

- Public launch to the Kaspa community with the audit report in hand
- Onboard bot creators (the operator kit is ready)
- Parallel deploy to Kasplex if there's demand

## What I need FROM YOU (nobody else can do these)

1. **Budget decision** for the audit route (Phase B) — this is the real spend
2. **A lawyer** for Phase C legal review
3. **Explicit go-ahead + real funds** for any mainnet deployment
4. Patience: rushing B or C is how projects get drained

## Sources (audit pricing, researched 2026-07-16)

- [Sherlock — audit pricing reference 2026](https://sherlock.xyz/post/smart-contract-audit-pricing-a-market-reference-for-2026)
- [Audit cost $5K–$500K breakdown](https://bugblow.com/blog/smart-contract-audit-cost-2026-pricing-guide)
- [Code4rena vs Sherlock crowdsourced audits](https://hackenproof.com/blog/for-business/code4rena-vs-sherlock-crowdsourced-audits-comparison-guide)
- [Zealynx — audit pricing 2026 (DeFi/vaults)](https://www.zealynx.io/research/audit-ops/audit-pricing-2026)
