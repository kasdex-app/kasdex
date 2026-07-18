"""
Strategy base class + runner loop.

A strategy sees the vault state and a price history, and returns an Action
(or None to hold). The runner handles polling, dry-run mode, and logging —
strategies stay pure decision logic.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass

from .vault_operator import VaultOperator


@dataclass
class Action:
    token_in: str
    token_out: str
    amount_in_wei: int
    reason: str


class Strategy(ABC):
    """Subclass this. `decide` is called once per tick."""

    #: pair the runner tracks for the price series: (token_in, token_out)
    price_pair: tuple[str, str] | None = None

    @abstractmethod
    def decide(self, op: VaultOperator, prices: list[float]) -> Action | None:
        """Return an Action to trade, or None to hold."""


def run_strategy(
    strategy: Strategy,
    op: VaultOperator,
    interval_sec: int = 30,
    dry_run: bool = True,
    max_ticks: int | None = None,
    max_slippage_pct: float = 1.0,
) -> None:
    mode = 'DRY-RUN (no transactions)' if dry_run else 'LIVE'
    print(f'Runner: {type(strategy).__name__} on vault {op.vault.address} [{mode}]')
    print(f'Signer: {op.address} (operator: {op.is_operator})')
    if not dry_run and not op.is_operator:
        raise RuntimeError('Refusing LIVE mode: signer is not the vault operator')

    prices: list[float] = []
    tick = 0
    while max_ticks is None or tick < max_ticks:
        tick += 1
        try:
            if strategy.price_pair:
                price = op.spot_price(*strategy.price_pair)
                prices.append(price)
                pair = f'{op.symbol(strategy.price_pair[0])}->{op.symbol(strategy.price_pair[1])}'
                print(f'[tick {tick}] {pair} spot {price:.6f} · flat={op.is_flat()}')

            action = strategy.decide(op, prices)
            if action is None:
                print(f'[tick {tick}] hold')
            elif dry_run:
                print(f'[tick {tick}] WOULD TRADE {action.amount_in_wei / 1e18:.6f} '
                      f'{op.symbol(action.token_in)} -> {op.symbol(action.token_out)} · {action.reason}')
            else:
                tx, quoted = op.execute_swap(
                    action.token_in, action.token_out, action.amount_in_wei, max_slippage_pct,
                )
                print(f'[tick {tick}] TRADED {action.amount_in_wei / 1e18:.6f} '
                      f'{op.symbol(action.token_in)} -> ~{quoted / 1e18:.6f} '
                      f'{op.symbol(action.token_out)} · {action.reason} · tx {tx}')
        except Exception as exc:  # keep the loop alive on transient RPC errors
            print(f'[tick {tick}] error: {exc}')

        if max_ticks is not None and tick >= max_ticks:
            break
        time.sleep(interval_sec)
