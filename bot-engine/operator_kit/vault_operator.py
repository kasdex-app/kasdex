"""
VaultOperator — the SDK a bot creator uses to trade their StrategyVault.

The operator key can ONLY route vault funds through KasDex between the
vault's allowlisted tokens (enforced by the contract, not this client).
Deposit/withdraw helpers are included for dev convenience.

Environment:
    OPERATOR_PRIVATE_KEY   signer for vault.executeSwap (falls back to
                           DEPLOYER_PRIVATE_KEY in ../contracts/.env)
"""

from __future__ import annotations

import json
import os

from web3 import Web3

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DEPLOYMENT = os.path.join(HERE, '..', '..', 'contracts', 'deployments', 'galleon.json')
DEFAULT_RPC = 'https://galleon-testnet.igralabs.com:8545'

VAULT_ABI = [
    {"name": "executeSwap", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "tokenIn", "type": "address"}, {"name": "tokenOut", "type": "address"},
                {"name": "amountIn", "type": "uint256"}, {"name": "minAmountOut", "type": "uint256"},
                {"name": "deadline", "type": "uint256"}],
     "outputs": [{"name": "amountOut", "type": "uint256"}]},
    {"name": "deposit", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "amount", "type": "uint256"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "withdraw", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "shares", "type": "uint256"}], "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "isFlat", "type": "function", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "holdings", "type": "function", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "tokens", "type": "address[]"}, {"name": "balances", "type": "uint256[]"}]},
    {"name": "operator", "type": "function", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "address"}]},
    {"name": "baseToken", "type": "function", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "address"}]},
    {"name": "dex", "type": "function", "stateMutability": "view", "inputs": [],
     "outputs": [{"name": "", "type": "address"}]},
    {"name": "sharesOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "", "type": "address"}], "outputs": [{"name": "", "type": "uint256"}]},
]

DEX_ABI = [
    {"name": "getAmountOut", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "tokenIn", "type": "address"}, {"name": "tokenOut", "type": "address"},
                {"name": "amountIn", "type": "uint256"}],
     "outputs": [{"name": "", "type": "uint256"}]},
]

ERC20_ABI = [
    {"name": "approve", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "allowance", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}, {"name": "spender", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "deposit", "type": "function", "stateMutability": "payable", "inputs": [], "outputs": []},
]


def _load_key() -> str:
    key = os.environ.get('OPERATOR_PRIVATE_KEY')
    if key:
        return key
    env_path = os.path.join(HERE, '..', '..', 'contracts', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith('DEPLOYER_PRIVATE_KEY='):
                    return line.split('=', 1)[1].strip()
    raise RuntimeError('Set OPERATOR_PRIVATE_KEY (or provide contracts/.env)')


class VaultOperator:
    def __init__(
        self,
        vault_address: str | None = None,
        rpc_url: str = DEFAULT_RPC,
        deployment_path: str = DEFAULT_DEPLOYMENT,
        private_key: str | None = None,
    ):
        self.w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={'timeout': 30}))
        if not self.w3.is_connected():
            raise RuntimeError(f'Cannot reach {rpc_url}')
        self.chain_id = self.w3.eth.chain_id

        self.symbols: dict[str, str] = {}
        contracts: dict[str, str] = {}
        if os.path.exists(deployment_path):
            with open(deployment_path) as f:
                contracts = json.load(f)['contracts']
            self.symbols = {addr.lower(): sym for sym, addr in contracts.items()}

        vault_address = vault_address or contracts.get('Vault0')
        if not vault_address:
            raise RuntimeError('No vault address (pass vault_address or provide a deployment file)')

        self.account = self.w3.eth.account.from_key(private_key or _load_key())
        self.vault = self.w3.eth.contract(address=vault_address, abi=VAULT_ABI)
        self.dex = self.w3.eth.contract(address=self.vault.functions.dex().call(), abi=DEX_ABI)
        self.base_token: str = self.vault.functions.baseToken().call()

    # ------------------------------------------------------------------
    # reads
    # ------------------------------------------------------------------

    @property
    def address(self) -> str:
        return self.account.address

    @property
    def is_operator(self) -> bool:
        return self.vault.functions.operator().call().lower() == self.address.lower()

    def symbol(self, token: str) -> str:
        return self.symbols.get(token.lower(), token[:8])

    def is_flat(self) -> bool:
        return self.vault.functions.isFlat().call()

    def holdings(self) -> dict[str, int]:
        tokens, balances = self.vault.functions.holdings().call()
        return {t: b for t, b in zip(tokens, balances)}

    def quote(self, token_in: str, token_out: str, amount_in_wei: int) -> int:
        return self.dex.functions.getAmountOut(token_in, token_out, amount_in_wei).call()

    def spot_price(self, token_in: str, token_out: str) -> float:
        """Marginal price via a tiny probe quote (fee included)."""
        probe = 10**15  # 0.001 tokens
        out = self.quote(token_in, token_out, probe)
        return out / probe

    def chain_deadline(self, seconds: int = 600) -> int:
        # ALWAYS chain time — local clocks drift
        return self.w3.eth.get_block('latest')['timestamp'] + seconds

    # ------------------------------------------------------------------
    # writes
    # ------------------------------------------------------------------

    def _send(self, fn, value: int = 0) -> str:
        tx = fn.build_transaction({
            'from': self.address,
            'nonce': self.w3.eth.get_transaction_count(self.address),
            'gas': 400_000,
            'gasPrice': self.w3.eth.gas_price,
            'chainId': self.chain_id,
            'value': value,
        })
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt['status'] != 1:
            raise RuntimeError(f'tx reverted: {tx_hash.hex()}')
        return tx_hash.hex()

    def execute_swap(
        self,
        token_in: str,
        token_out: str,
        amount_in_wei: int,
        max_slippage_pct: float = 1.0,
    ) -> tuple[str, int]:
        """Trade vault funds through KasDex. Returns (tx_hash, quoted_out_wei)."""
        if not self.is_operator:
            raise RuntimeError(f'{self.address} is not this vault\'s operator')

        vault_balance = self.holdings().get(token_in, 0)
        if amount_in_wei > vault_balance:
            raise RuntimeError(
                f'Vault holds {vault_balance / 1e18:.6f} {self.symbol(token_in)}, '
                f'tried to trade {amount_in_wei / 1e18:.6f}'
            )

        quoted = self.quote(token_in, token_out, amount_in_wei)
        min_out = int(quoted * (1 - max_slippage_pct / 100))

        tx = self._send(self.vault.functions.executeSwap(
            token_in, token_out, amount_in_wei, min_out, self.chain_deadline(),
        ))
        return tx, quoted

    # ------------------------------------------------------------------
    # dev conveniences (depositor role, not operator role)
    # ------------------------------------------------------------------

    def deposit(self, amount_wei: int) -> str:
        """Wrap (if base is WKAS and balance is short), approve, deposit."""
        base = self.w3.eth.contract(address=self.base_token, abi=ERC20_ABI)
        if base.functions.balanceOf(self.address).call() < amount_wei:
            self._send(base.functions.deposit(), value=amount_wei)  # WKAS wrap
        if base.functions.allowance(self.address, self.vault.address).call() < amount_wei:
            self._send(base.functions.approve(self.vault.address, 2**256 - 1))
        return self._send(self.vault.functions.deposit(amount_wei))

    def withdraw_all(self) -> str:
        shares = self.vault.functions.sharesOf(self.address).call()
        if shares == 0:
            raise RuntimeError('No shares to withdraw')
        return self._send(self.vault.functions.withdraw(shares))
