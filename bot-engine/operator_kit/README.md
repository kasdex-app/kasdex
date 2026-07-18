# Operator Kit — run a strategy against your KasDex vault

The SDK a bot creator uses to trade their StrategyVault on Igra Galleon.
Your key can ONLY route vault funds through KasDex between the vault's
allowlisted tokens — the contract enforces that, not this client. Depositors
keep custody and can exit at any time; your track record accrues on-chain
where nobody can fake it.

## Creator flow

1. **Register your bot** — in the KasDex app: Bots → "+ Publish your bot"
   (or call `BotRegistry.registerBot` yourself). Note your botId.
2. **Create your vault** — `VaultFactory.createVault(botId, baseToken,
   allowedTokens)` from the same wallet that registered the bot. Your
   performance fee is snapshotted at this moment and can never rise for
   existing depositors.
3. **(Optional) dedicated operator key** — `vault.setOperator(botKey)` so
   your server key is not your creator wallet.
4. **Configure** — `export OPERATOR_PRIVATE_KEY=0x…` (or it falls back to
   `contracts/.env` for local dev).
5. **Write a strategy** — subclass `Strategy`, implement `decide`:

```python
from operator_kit import Action, Strategy, VaultOperator, run_strategy

class MyStrategy(Strategy):
    def __init__(self, base, quote):
        self.base, self.quote = base, quote
        self.price_pair = (base, quote)   # runner feeds you this spot price

    def decide(self, op, prices):
        if op.is_flat() and my_signal(prices):
            amount = op.holdings()[self.base] // 10
            return Action(self.base, self.quote, amount, 'signal fired')
        return None                        # hold

op = VaultOperator()                       # reads deployments/galleon.json
run_strategy(MyStrategy(op.base_token, TUSDT), op, dry_run=True)
```

6. **Dry-run first** (`dry_run=True` is the default), then go live.

## Examples

```bash
cd ~/Downloads/kaspa-dex/bot-engine

# full lifecycle proof — deposit, open, unwind, PnL (real testnet txs)
python3 -m operator_kit.examples.demo_cycle

# SMA mean-reversion, dry-run, 5 ticks at 10s
python3 -m operator_kit.examples.sma_momentum --ticks 5 --interval 10

# the same, actually trading
python3 -m operator_kit.examples.sma_momentum --live
```

## SDK surface (`VaultOperator`)

| Call | What it does |
|------|--------------|
| `holdings()` | vault balances per token (wei) |
| `is_flat()` | vault 100% in base token? |
| `quote(in, out, wei)` / `spot_price(in, out)` | KasDex pricing |
| `execute_swap(in, out, wei, max_slippage_pct)` | THE trade call — operator only |
| `deposit(wei)` / `withdraw_all()` | depositor-role dev helpers |
| `chain_deadline(s)` | deadline from **chain** time (never local clocks) |

Gotchas baked in: Galleon's 2000 gwei gas floor is read from the node, and
deadlines always come from the chain's block timestamp because local clocks
drift.
