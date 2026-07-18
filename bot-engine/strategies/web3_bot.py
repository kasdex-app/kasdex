"""
On-chain bot skeleton for the Kaspa EVM L2 testnets.

Read-only by default: connects to Igra Galleon, reports chain state, and
(once contracts are deployed) quotes the WKAS/tUSDT pool straight from the
KasDex contract. If DEPLOYER_PRIVATE_KEY is set in contracts/.env AND the
account holds iKAS, --swap sends a real testnet swap transaction.

Usage:
    python3 web3_bot.py            # read-only status + on-chain quote
    python3 web3_bot.py --swap     # execute a 1 WKAS -> tUSDT testnet swap
"""

from __future__ import annotations

import json
import os
import sys

from web3 import Web3

HERE = os.path.dirname(os.path.abspath(__file__))
CONTRACTS_DIR = os.path.join(HERE, "..", "..", "contracts")

RPC_URL = "https://galleon-testnet.igralabs.com:8545"
EXPECTED_CHAIN_ID = 38836
DEPLOYMENT_FILE = os.path.join(CONTRACTS_DIR, "deployments", "galleon.json")

KASDEX_ABI = [
    {"name": "getAmountOut", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "tokenIn", "type": "address"}, {"name": "tokenOut", "type": "address"},
                {"name": "amountIn", "type": "uint256"}],
     "outputs": [{"name": "amountOut", "type": "uint256"}]},
    {"name": "swapExactIn", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "tokenIn", "type": "address"}, {"name": "tokenOut", "type": "address"},
                {"name": "amountIn", "type": "uint256"}, {"name": "minAmountOut", "type": "uint256"},
                {"name": "to", "type": "address"}, {"name": "deadline", "type": "uint256"}],
     "outputs": [{"name": "amountOut", "type": "uint256"}]},
    {"name": "getPool", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "tokenA", "type": "address"}, {"name": "tokenB", "type": "address"}],
     "outputs": [{"name": "token0", "type": "address"}, {"name": "token1", "type": "address"},
                 {"name": "reserve0", "type": "uint256"}, {"name": "reserve1", "type": "uint256"},
                 {"name": "totalShares", "type": "uint256"}, {"name": "feeBps", "type": "uint16"}]},
]

ERC20_ABI = [
    {"name": "approve", "type": "function", "stateMutability": "nonpayable",
     "inputs": [{"name": "spender", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "outputs": [{"name": "", "type": "bool"}]},
    {"name": "balanceOf", "type": "function", "stateMutability": "view",
     "inputs": [{"name": "owner", "type": "address"}],
     "outputs": [{"name": "", "type": "uint256"}]},
    {"name": "deposit", "type": "function", "stateMutability": "payable", "inputs": [], "outputs": []},
]


def load_private_key() -> str | None:
    env_path = os.path.join(CONTRACTS_DIR, ".env")
    if not os.path.exists(env_path):
        return None
    with open(env_path) as f:
        for line in f:
            if line.startswith("DEPLOYER_PRIVATE_KEY="):
                return line.split("=", 1)[1].strip()
    return None


def main() -> None:
    w3 = Web3(Web3.HTTPProvider(RPC_URL, request_kwargs={"timeout": 20}))
    if not w3.is_connected():
        sys.exit(f"Cannot reach {RPC_URL}")

    chain_id = w3.eth.chain_id
    block = w3.eth.block_number
    print(f"Connected: {RPC_URL}")
    print(f"Chain ID:  {chain_id} ({'OK' if chain_id == EXPECTED_CHAIN_ID else 'UNEXPECTED'})")
    print(f"Block:     {block}")

    if not os.path.exists(DEPLOYMENT_FILE):
        print("\nNo deployment yet (contracts/deployments/galleon.json missing).")
        print("Fund the deployer at the faucet, then: cd contracts && npm run deploy:galleon")
        return

    with open(DEPLOYMENT_FILE) as f:
        contracts = json.load(f)["contracts"]

    dex = w3.eth.contract(address=contracts["KasDex"], abi=KASDEX_ABI)
    wkas, usdt = contracts["WKAS"], contracts["tUSDT"]

    pool = dex.functions.getPool(wkas, usdt).call()
    print(f"\nWKAS/tUSDT pool: reserves {w3.from_wei(pool[2], 'ether')} / {w3.from_wei(pool[3], 'ether')}, fee {pool[5] / 100}%")

    amount_in = w3.to_wei(1, "ether")
    quote = dex.functions.getAmountOut(wkas, usdt, amount_in).call()
    print(f"On-chain quote: 1 WKAS -> {w3.from_wei(quote, 'ether')} tUSDT")

    if "--swap" not in sys.argv:
        return

    key = load_private_key()
    if not key:
        sys.exit("No DEPLOYER_PRIVATE_KEY in contracts/.env")

    account = w3.eth.account.from_key(key)
    balance = w3.eth.get_balance(account.address)
    print(f"\nSigner {account.address} balance: {w3.from_wei(balance, 'ether')} iKAS")
    if balance == 0:
        sys.exit("Signer has no iKAS for gas — claim at https://faucet.zealousswap.com")

    min_out = quote * 99 // 100  # 1% slippage tolerance
    # deadline from CHAIN time, not local time — this machine's clock drifts
    deadline = w3.eth.get_block("latest")["timestamp"] + 600

    def send(fn, value: int = 0) -> str:
        tx = fn.build_transaction({
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address),
            "gas": 300_000,
            "gasPrice": w3.eth.gas_price,
            "chainId": chain_id,
            "value": value,
        })
        signed = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        assert receipt["status"] == 1, f"tx reverted: {tx_hash.hex()}"
        return tx_hash.hex()

    wkas_token = w3.eth.contract(address=wkas, abi=ERC20_ABI)
    if wkas_token.functions.balanceOf(account.address).call() < amount_in:
        if balance < amount_in + w3.to_wei(0.05, "ether"):
            sys.exit("Not enough iKAS to wrap — claim at https://faucet.zealousswap.com")
        print("Wrapping 1 iKAS into WKAS…")
        send(wkas_token.functions.deposit(), value=amount_in)

    print("Approving WKAS…")
    send(wkas_token.functions.approve(contracts["KasDex"], amount_in))
    print("Swapping 1 WKAS -> tUSDT…")
    tx = send(dex.functions.swapExactIn(wkas, usdt, amount_in, min_out, account.address, deadline))
    print(f"Swap confirmed on Galleon testnet: {tx}")


if __name__ == "__main__":
    main()
