#!/bin/sh
# Waits for the throwaway deployer to be funded on Igra Galleon, then deploys
# the contracts and runs the first on-chain swap. Testnet only.
set -u

ADDR="0xd22AD5a2EA244ce90fA74Da909559C383E5D56b4"
RPC="https://galleon-testnet.igralabs.com:8545"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/autodeploy.log"
export PATH="$HOME/.local/node/bin:$PATH"

echo "[$(date '+%H:%M:%S')] watching $ADDR on Galleon (checks every 60s, max 12h)" | tee "$LOG"

i=0
while [ $i -lt 720 ]; do
  BAL=$(curl -s -m 15 -X POST "$RPC" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$ADDR\",\"latest\"],\"id\":1}" \
    | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')

  if [ -n "$BAL" ] && [ "$BAL" != "0x0" ]; then
    echo "[$(date '+%H:%M:%S')] FUNDED (balance $BAL) — deploying to Galleon" | tee -a "$LOG"
    cd "$DIR" || exit 1
    if npm run deploy:galleon >> "$LOG" 2>&1; then
      echo "[$(date '+%H:%M:%S')] deploy OK — running first on-chain swap" | tee -a "$LOG"
      python3 ../bot-engine/strategies/web3_bot.py --swap >> "$LOG" 2>&1 \
        && echo "[$(date '+%H:%M:%S')] SWAP CONFIRMED — full stack live on Galleon" | tee -a "$LOG" \
        || echo "[$(date '+%H:%M:%S')] swap failed — see log" | tee -a "$LOG"
    else
      echo "[$(date '+%H:%M:%S')] deploy FAILED — see log" | tee -a "$LOG"
    fi
    exit 0
  fi

  i=$((i + 1))
  sleep 60
done

echo "[$(date '+%H:%M:%S')] gave up after 12h without funding" | tee -a "$LOG"
exit 1
