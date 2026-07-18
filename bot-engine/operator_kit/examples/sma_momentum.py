"""
Example strategy: SMA mean-reversion between the vault's base token (WKAS)
and tUSDT. Illustrative, not financial advice — the point is showing how
little code a working vault strategy needs.

Rules (all sizes intentionally small for the testnet):
  - Track the WKAS->tUSDT spot price each tick.
  - Flat + price at least DIP_PCT below the SMA  -> spend 10% of vault WKAS
    on tUSDT (base looks cheap in tUSDT terms... we are accumulating quote).
  - Holding tUSDT + price back above the SMA     -> unwind to WKAS.

Usage (from bot-engine/):
    python3 -m operator_kit.examples.sma_momentum             # dry-run
    python3 -m operator_kit.examples.sma_momentum --live      # real txs
    python3 -m operator_kit.examples.sma_momentum --ticks 5 --interval 10
"""

from __future__ import annotations

import sys

from operator_kit import Action, Strategy, VaultOperator, run_strategy

SMA_WINDOW = 10
DIP_PCT = 0.5     # trigger threshold vs SMA, in percent
TRADE_FRACTION = 0.10  # of vault base balance per entry


class SmaMeanReversion(Strategy):
    def __init__(self, base: str, quote: str):
        self.base = base
        self.quote = quote
        self.price_pair = (base, quote)

    def decide(self, op: VaultOperator, prices: list[float]) -> Action | None:
        if len(prices) < SMA_WINDOW:
            return None  # warm-up

        sma = sum(prices[-SMA_WINDOW:]) / SMA_WINDOW
        price = prices[-1]
        holdings = op.holdings()

        if op.is_flat():
            if price < sma * (1 - DIP_PCT / 100):
                amount = int(holdings.get(self.base, 0) * TRADE_FRACTION)
                if amount > 0:
                    return Action(self.base, self.quote, amount,
                                  f'price {price:.6f} is {DIP_PCT}%+ below SMA {sma:.6f}')
        else:
            quote_bal = holdings.get(self.quote, 0)
            if quote_bal > 0 and price >= sma:
                return Action(self.quote, self.base, quote_bal,
                              f'price {price:.6f} recovered to SMA {sma:.6f} — unwinding')
        return None


def main() -> None:
    op = VaultOperator()
    quote_token = next(
        (a for a, s in [(k, op.symbol(k)) for k in op.holdings()] if s == 'tUSDT'),
        None,
    )
    if not quote_token:
        sys.exit('Vault has no tUSDT in its allowlist')

    args = sys.argv[1:]
    get = lambda flag, default: int(args[args.index(flag) + 1]) if flag in args else default

    run_strategy(
        SmaMeanReversion(op.base_token, quote_token),
        op,
        interval_sec=get('--interval', 30),
        dry_run='--live' not in args,
        max_ticks=get('--ticks', None) if '--ticks' in args else None,
    )


if __name__ == '__main__':
    main()
