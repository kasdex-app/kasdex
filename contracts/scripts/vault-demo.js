/**
 * Live vault lifecycle demo on Galleon: deposit -> bot trades -> unwind ->
 * withdraw. Proves the non-custodial flow end to end with real txs.
 *
 * Run: npx hardhat run scripts/vault-demo.js --network galleon
 */
const fs = require('fs');
const path = require('path');
const { ethers, network } = require('hardhat');

const E = (v) => ethers.formatEther(v);

async function main() {
  const file = path.join(__dirname, '..', 'deployments', `${network.name}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8')).contracts;
  const [signer] = await ethers.getSigners();

  const wkas = await ethers.getContractAt('WKAS', c.WKAS);
  const usdt = await ethers.getContractAt('MockERC20', c.tUSDT);
  const vault = await ethers.getContractAt('StrategyVault', c.Vault0);

  const deadline = () => ethers.provider.getBlock('latest').then((b) => b.timestamp + 600);

  console.log(`Vault ${c.Vault0} (bot #0, base WKAS)\n`);

  // 1. wrap + deposit 1 WKAS
  await (await wkas.deposit({ value: ethers.parseEther('1') })).wait();
  await (await wkas.approve(c.Vault0, ethers.MaxUint256)).wait();
  await (await vault.deposit(ethers.parseEther('1'))).wait();
  console.log(`1. Deposited 1 WKAS — shares: ${E(await vault.sharesOf(signer.address))}`);

  // 2. bot (operator = creator = this signer) opens a position
  await (await vault.executeSwap(c.WKAS, c.tUSDT, ethers.parseEther('0.2'), 0, await deadline())).wait();
  const usdtBal = await usdt.balanceOf(c.Vault0);
  console.log(`2. Bot traded 0.2 WKAS -> ${E(usdtBal)} tUSDT (held BY THE VAULT)`);
  console.log(`   isFlat: ${await vault.isFlat()}`);

  // 3. unwind back to base
  await (await vault.executeSwap(c.tUSDT, c.WKAS, usdtBal, 0, await deadline())).wait();
  const [tokens, balances] = await vault.holdings();
  for (let i = 0; i < tokens.length; i++) {
    console.log(`3. Vault holds ${E(balances[i])} of ${tokens[i] === c.WKAS ? 'WKAS' : tokens[i] === c.tUSDT ? 'tUSDT' : 'tETH'}`);
  }
  console.log(`   isFlat: ${await vault.isFlat()}`);

  // 4. withdraw everything
  const myShares = await vault.sharesOf(signer.address);
  const before = await wkas.balanceOf(signer.address);
  const tx = await vault.withdraw(myShares);
  const receipt = await tx.wait();
  const got = (await wkas.balanceOf(signer.address)) - before;
  console.log(`4. Withdrew ${E(myShares)} shares -> ${E(got)} WKAS back (round-trip DEX fees realized as loss, no perf fee)`);
  console.log(`   tx ${receipt.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
