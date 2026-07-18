/**
 * Deploys VaultFactory on top of an existing deployment and creates the
 * vault for bot #0. Updates deployments/<network>.json in place.
 *
 * Run: npx hardhat run scripts/deploy-vaults.js --network galleon
 */
const fs = require('fs');
const path = require('path');
const { ethers, network } = require('hardhat');

async function main() {
  const file = path.join(__dirname, '..', 'deployments', `${network.name}.json`);
  const deployment = JSON.parse(fs.readFileSync(file, 'utf8'));
  const c = deployment.contracts;

  const [deployer] = await ethers.getSigners();
  console.log(`Network:  ${network.name} (chainId ${network.config.chainId ?? 'local'})`);
  console.log(`Deployer: ${deployer.address}\n`);

  const factory = await (await ethers.getContractFactory('VaultFactory')).deploy(c.BotRegistry, c.KasDex);
  await factory.waitForDeployment();
  console.log(`VaultFactory: ${await factory.getAddress()}`);

  // 25% max risk-increasing trade, 60s cooldown (unwinds are always free)
  const tx = await factory.createVault(0, c.WKAS, [c.tUSDT, c.tETH], 2500, 60);
  await tx.wait();
  const vault0 = await factory.vaultByBot(0);
  console.log(`Vault (bot #0): ${vault0} (cap 25%/trade, cooldown 60s)`);

  deployment.contracts.VaultFactory = await factory.getAddress();
  deployment.contracts.Vault0 = vault0;
  fs.writeFileSync(file, JSON.stringify(deployment, null, 2));
  console.log(`\nUpdated deployments/${network.name}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
