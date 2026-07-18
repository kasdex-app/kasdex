# Reality Check — Corrected Plan (verified July 15, 2026)

The original plan in [kaspa-dex-project-plan.md](kaspa-dex-project-plan.md) was written
without web access and contains several load-bearing errors. This document is the
corrected foundation, verified against primary sources.

---

## What the original plan got wrong

| # | Original claim | Reality |
|---|----------------|---------|
| 1 | Smart contracts in "Rust via Kaspa's VM" | **Kaspa L1 has no smart-contract VM.** It is a UTXO blockDAG. Contracts run on EVM-compatible L2s → the contract language is **Solidity**, with standard Ethereum tooling (Hardhat/Foundry, MetaMask, ethers.js/viem, web3.py). |
| 2 | `cargo install kaspa-cli` | Not a real install path for contract dev. The rusty-kaspa repo ships node binaries (`kaspad`), which you don't need for a DEX on an L2. |
| 3 | RPC `https://kaspa-testnet-rpc.somerelay.com` | Fabricated endpoint. Real endpoints are below. |
| 4 | Roadmap "Q3 2024: MVP…" | Stale dates; it's July 2026. |
| 5 | "Few good DEXs exist yet — first mover" | Partially outdated. Zealous Swap is live on **both** L2s; KaspaFinance runs AI trading bots on Kasplex. See Competition. |

---

## The real Kaspa smart-contract landscape (July 2026)

Kaspa L1 (10 blocks/sec since the Crescendo hardfork) acts as the sequencing/data
layer. Two EVM L2s ("based rollups") are live on mainnet:

### Option A — Kasplex zkEVM (mainnet since Aug 31, 2025)

| Param | Mainnet | Testnet |
|-------|---------|---------|
| Chain ID | `202555` | `167012` |
| RPC | `https://evmrpc.kasplex.org` | `https://rpc.kasplextest.xyz` |
| Explorer | `https://explorer.kasplex.org` | (testnet explorer via docs) |
| Gas token | Bridged KAS | Testnet KAS (faucet) |
| Bridge | `kasbridge-evm.kaspafoundation.org` | — |

Backed by the Kaspa Eco Foundation. Fully EVM-equivalent: Solidity, Hardhat,
Remix, MetaMask all work as-is.

### Option B — Igra Network (mainnet since Mar 19, 2026)

| Param | Mainnet | Galleon testnet |
|-------|---------|-----------------|
| Chain ID | `38833` | `38836` |
| RPC | `https://rpc.igralabs.com:8545` | `https://galleon-testnet.igralabs.com:8545` |
| Gas token | iKAS (bridged KAS) | iKAS — faucet: [faucet.zealousswap.com](https://faucet.zealousswap.com) (3,000 iKAS / 24h, hCaptcha) |
| Docs | `igra-labs.gitbook.io/igralabs-docs` | — |

> Verified live 2026-07-15: both testnet RPCs answer (Galleon block ~14.97M,
> Kasplex testnet block ~31.8M). The older **Caravel** testnet (chain 19416)
> was retired — its DNS no longer resolves.

3,000+ TPS, sub-second inclusion, no centralized sequencer (MEV-resistant by
architecture), IGRA governance token auctioned Mar–Apr 2026. Second-gen execution
engine (Block-STM) planned H2 2026, plus "agent-native" machine-to-machine
payment infrastructure — which aligns directly with the AI-bot thesis.

**Recommendation:** prototype on both testnets (they're free), lean toward
**Igra** for launch — decentralized sequencing is a real marketing + technical
differentiator for a trading product, its agent-native roadmap matches ours, and
Kasplex already hosts the most direct competitor.

---

## Corrected tech stack

| Component | Choice |
|-----------|--------|
| Smart contracts | **Solidity** (Uniswap-V2-style factory/pair/router + BotRegistry + ERC-4626-style strategy vaults) |
| Contract tooling | Hardhat or Foundry |
| Frontend | React + TypeScript + Vite (done) + wagmi/viem for wallet in Phase 2 |
| Wallet | MetaMask (custom RPC) works today on both L2s; Kasware/Kastle for L1 KAS |
| Backend/indexer | Node.js + TypeScript (done); ethers.js event listeners in Phase 2 |
| Bot engine | Python + `web3.py` (standard EVM, works on both L2s) |
| L1 data | `api.kaspa.org` REST for KAS price/UTXO context |

---

## Competition (verified)

- **Zealous Swap** — first DEX on Kaspa, live on Kasplex mainnet AND Igra.
  Protocol-owned liquidity, insurance fund, NFT-based fees. Kasplex testnet had
  229 pools / ~$160K TVL in mid-2025 (small — the market is early).
- **KaspaFinance (KFC)** — DeFi suite on Kasplex zkEVM including **"AI KasBot
  Trading"**: first-party AI-powered trading bots on pairs like KAS/WETH/WBTC.
  ⚠️ Their product is literally named "KasBot" — **our project needs a different
  name** (working title in code stays until we pick one).
- **KSPR / KRC-20 marketplaces** — inscription-token trading on L1; different
  niche, not AMM competition.

**The gap that remains open:** nobody runs an *open marketplace* where
third-party bot creators publish strategies, traders subscribe, and creators earn
performance fees on-chain. KaspaFinance's bots are first-party only. That
creator-economy layer is the moat from the original thesis, and it is still
unclaimed on Kaspa.

---

## Revised phases

1. **Phase 1 (done today):** local simulated AMM + bot marketplace UI — running.
2. **Phase 2:** Solidity contracts (AMM fork + BotRegistry) on Igra Caravel
   testnet + Kasplex testnet; MetaMask connect; real quotes from on-chain
   reserves; Python bots signing real testnet txs via web3.py.
3. **Phase 3:** strategy vaults (deposit → bot trades non-custodially → fee
   split), reputation/performance tracking from on-chain history, audit,
   mainnet.

Non-custodial vault design also mitigates the money-transmitter concern from the
original discussion (funds sit in a contract the user controls, not with us) —
still needs real legal review before mainnet.

---

## Sources

- [Kasplex zkEVM mainnet launch announcement](https://x.com/kasplex/status/1971469795317960800)
- [Kasplex zkEVM testnet on ChainList (167012)](https://chainlist.org/chain/167012)
- [Kasplex L2 docs](https://docs-kasplex.gitbook.io/l2-network)
- [Igra mainnet launch (TradingView/Chainwire)](https://www.tradingview.com/news/chainwire:48fbb241f094b:0-igra-network-launches-public-mainnet-as-decentralized-evm-layer-on-kaspa-s-proof-of-work-blockdag/)
- [Igra Mainnet on ChainList (38833)](https://chainlist.org/chain/38833)
- [Igra Network docs](https://igra-labs.gitbook.io/igralabs-docs)
- [Zealous Swap](https://www.zealousswap.com/) · [on DefiLlama](https://defillama.com/protocol/zealousswap)
- [KaspaFinance AI KasBot whitepaper section](https://kaspa-finance.gitbook.io/kaspa-finance-whitepaper/ai-kasbot-trading)
