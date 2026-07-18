"""
End-to-end proof of the operator kit: fund the vault if empty, open a small
position through vault.executeSwap, unwind it, and report the realized PnL.
Every step is a real transaction on Igra Galleon.

Usage (from bot-engine/):
    python3 -m operator_kit.examples.demo_cycle
"""

from __future__ import annotations

import sys

from operator_kit import VaultOperator

E = lambda wei: wei / 1e18


def main() -> None:
    op = VaultOperator()
    print(f'Vault:    {op.vault.address}')
    print(f'Operator: {op.address} (is_operator={op.is_operator})')
    if not op.is_operator:
        sys.exit('Signer is not the operator — set OPERATOR_PRIVATE_KEY')

    quote_token = next((k for k in op.holdings() if op.symbol(k) == 'tUSDT'), None)
    if not quote_token:
        sys.exit('Vault allowlist has no tUSDT')

    # 1. ensure the vault has working capital
    base_bal = op.holdings().get(op.base_token, 0)
    if base_bal < int(0.5e18):
        print('1. Vault low — depositing 1 WKAS (wrap/approve/deposit)…')
        tx = op.deposit(int(1e18))
        print(f'   deposited · tx {tx}')
        base_bal = op.holdings().get(op.base_token, 0)
    print(f'1. Vault base balance: {E(base_bal):.6f} WKAS · flat={op.is_flat()}')

    # 2. open: trade 20% of base into tUSDT
    amount = base_bal // 5
    tx, quoted = op.execute_swap(op.base_token, quote_token, amount)
    print(f'2. Opened: {E(amount):.6f} WKAS -> ~{E(quoted):.6f} tUSDT · tx {tx}')
    print(f'   flat={op.is_flat()} (position held BY THE VAULT)')

    # 3. unwind everything back to base
    quote_bal = op.holdings().get(quote_token, 0)
    tx, quoted = op.execute_swap(quote_token, op.base_token, quote_bal)
    print(f'3. Unwound: {E(quote_bal):.6f} tUSDT -> ~{E(quoted):.6f} WKAS · tx {tx}')

    # 4. realized result of this round trip
    final_bal = op.holdings().get(op.base_token, 0)
    pnl = final_bal - base_bal
    print(f'4. Round trip PnL: {E(pnl):+.6f} WKAS (DEX fees + impact) · flat={op.is_flat()}')
    print('   This PnL is now verifiable on the KasDex Stats tab and /api/onchain/vaults.')


if __name__ == '__main__':
    main()
