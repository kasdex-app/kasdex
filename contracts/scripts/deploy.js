/**
 * Deploys WKAS, mock tokens, KasDex, and BotRegistry; seeds three pools;
 * writes addresses to deployments/<network>.json.
 *
 * Local:    npm run deploy:local
 * Caravel:  npm run deploy:caravel   (needs DEPLOYER_PRIVATE_KEY in .env + iKAS from faucet)
 */
const fs = require('fs');
const path = require('path');
const { ethers, network } = require('hardhat');

const E18 = (n) => ethers.parseEther(String(n));

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No deployer account — set DEPLOYER_PRIVATE_KEY in contracts/.env');

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Network:  ${network.name} (chainId ${network.config.chainId ?? 'local'})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} native\n`);

  const wkas = await (await ethers.getContractFactory('WKAS')).deploy();
  await wkas.waitForDeployment();
  console.log(`WKAS:        ${await wkas.getAddress()}`);

  const usdt = await (await ethers.getContractFactory('MockERC20')).deploy('Test USDT', 'tUSDT');
  await usdt.waitForDeployment();
  console.log(`tUSDT:       ${await usdt.getAddress()}`);

  const teth = await (await ethers.getContractFactory('MockERC20')).deploy('Test ETH', 'tETH');
  await teth.waitForDeployment();
  console.log(`tETH:        ${await teth.getAddress()}`);

  const dex = await (await ethers.getContractFactory('KasDex')).deploy();
  await dex.waitForDeployment();
  console.log(`KasDex:      ${await dex.getAddress()}`);

  const registry = await (await ethers.getContractFactory('BotRegistry')).deploy();
  await registry.waitForDeployment();
  console.log(`BotRegistry: ${await registry.getAddress()}\n`);

  // ---- seed pools (sized to fit a faucet-funded balance) ----
  const dexAddr = await dex.getAddress();

  // wrap native for the WKAS side; keep a margin for gas
  const wrapAmount = balance > E18(15) ? E18(10) : (balance * 6n) / 10n;
  await (await wkas.deposit({ value: wrapAmount })).wait();
  await (await usdt.mint(deployer.address, E18(10_000))).wait();
  await (await teth.mint(deployer.address, E18(10_000))).wait();

  for (const token of [wkas, usdt, teth]) {
    await (await token.approve(dexAddr, ethers.MaxUint256)).wait();
  }

  const half = wrapAmount / 2n;
  const NO_DEADLINE = ethers.MaxUint256;
  // 1 KAS ≈ 0.25 USDT; 1 ETH ≈ 12000 KAS (test ratios only)
  await (await dex.createPool(await wkas.getAddress(), await usdt.getAddress(), 30)).wait();
  await (await dex.addLiquidity(await wkas.getAddress(), await usdt.getAddress(), half, half / 4n, 0, NO_DEADLINE)).wait();
  console.log(`Pool WKAS/tUSDT seeded (${ethers.formatEther(half)} WKAS : ${ethers.formatEther(half / 4n)} tUSDT)`);

  await (await dex.createPool(await wkas.getAddress(), await teth.getAddress(), 30)).wait();
  await (await dex.addLiquidity(await wkas.getAddress(), await teth.getAddress(), half, half / 12000n, 0, NO_DEADLINE)).wait();
  console.log(`Pool WKAS/tETH seeded (${ethers.formatEther(half)} WKAS : ${ethers.formatEther(half / 12000n)} tETH)`);

  // ---- demo bot ----
  await (await registry.registerBot('Cross-Pool Arbitrage', 'https://example.com/strategies/arb.json', 2000)).wait();
  console.log('Registered demo bot #0 (Cross-Pool Arbitrage, 20% fee)\n');

  // ---- save ----
  const out = {
    network: network.name,
    chainId: network.config.chainId ?? 31337,
    deployer: deployer.address,
    deployedAtBlock: await ethers.provider.getBlockNumber(),
    contracts: {
      WKAS: await wkas.getAddress(),
      tUSDT: await usdt.getAddress(),
      tETH: await teth.getAddress(),
      KasDex: dexAddr,
      BotRegistry: await registry.getAddress(),
    },
  };
  const dir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Addresses written to deployments/${network.name}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
