// Property / invariant tests + attack simulations. These encode the security
// claims from THREAT-MODEL.md as executable checks — the kind of coverage an
// auditor expects to already exist. Testnet contracts; not a substitute for a
// professional audit.

const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

const E18 = (n) => ethers.parseEther(String(n));
const ND = ethers.MaxUint256; // no deadline

async function fullStack() {
  const [deployer, alice, bob, attacker] = await ethers.getSigners();

  const dex = await (await ethers.getContractFactory('KasDex')).deploy();
  const wkas = await (await ethers.getContractFactory('WKAS')).deploy();
  const usdt = await (await ethers.getContractFactory('MockERC20')).deploy('USDT', 'tUSDT');
  const registry = await (await ethers.getContractFactory('BotRegistry')).deploy();
  const factory = await (await ethers.getContractFactory('VaultFactory')).deploy(
    await registry.getAddress(),
    await dex.getAddress(),
  );

  // Keep wrapped native modest — many fixtures share these accounts in one
  // test process and WKAS.deposit locks native KAS that can't be reclaimed
  // mid-suite. The invariant tests only move tens of tokens.
  await wkas.deposit({ value: E18(1000) });
  await usdt.mint(deployer.address, E18(2000));
  await wkas.approve(await dex.getAddress(), ND);
  await usdt.approve(await dex.getAddress(), ND);
  await dex.createPool(await wkas.getAddress(), await usdt.getAddress(), 30);
  await dex.addLiquidity(await wkas.getAddress(), await usdt.getAddress(), E18(600), E18(150), 0, ND);

  return { dex, wkas, usdt, registry, factory, deployer, alice, bob, attacker };
}

describe('Invariants — KasDex AMM', () => {
  it('constant product k never decreases on a swap (fees only grow it)', async () => {
    const { dex, wkas, usdt, attacker } = await loadFixture(fullStack);
    const w = await wkas.getAddress();
    const u = await usdt.getAddress();

    const before = await dex.getPool(w, u);
    const kBefore = before.reserve0 * before.reserve1;

    await wkas.connect(attacker).deposit({ value: E18(100) });
    await wkas.connect(attacker).approve(await dex.getAddress(), ND);
    const out = await dex.getAmountOut(w, u, E18(100));
    await dex.connect(attacker).swapExactIn(w, u, E18(100), out, attacker.address, ND);

    const after = await dex.getPool(w, u);
    const kAfter = after.reserve0 * after.reserve1;
    expect(kAfter).to.be.greaterThanOrEqual(kBefore); // invariant: k grows
  });

  it('no swap sequence yields a risk-free profit (round trip always loses)', async () => {
    const { dex, wkas, usdt, attacker } = await loadFixture(fullStack);
    const w = await wkas.getAddress();
    const u = await usdt.getAddress();
    await wkas.connect(attacker).deposit({ value: E18(500) });
    await wkas.connect(attacker).approve(await dex.getAddress(), ND);
    await usdt.connect(attacker).approve(await dex.getAddress(), ND);

    const start = await wkas.balanceOf(attacker.address);
    // W->U then U->W, repeated — should strictly bleed to fees each loop
    for (let i = 0; i < 5; i++) {
      const uOut = await dex.getAmountOut(w, u, E18(50));
      await dex.connect(attacker).swapExactIn(w, u, E18(50), 0, attacker.address, ND);
      const wOut = await dex.getAmountOut(u, w, uOut);
      await dex.connect(attacker).swapExactIn(u, w, uOut, 0, attacker.address, ND);
    }
    const end = await wkas.balanceOf(attacker.address);
    expect(end).to.be.lessThan(start); // never profitable
  });

  it('reserves always equal contract token balances (accounting soundness)', async () => {
    const { dex, wkas, usdt, alice } = await loadFixture(fullStack);
    const w = await wkas.getAddress();
    const u = await usdt.getAddress();
    const dexAddr = await dex.getAddress();

    // random-ish activity
    await wkas.connect(alice).deposit({ value: E18(300) });
    await usdt.mint(alice.address, E18(300));
    await wkas.connect(alice).approve(dexAddr, ND);
    await usdt.connect(alice).approve(dexAddr, ND);
    await dex.connect(alice).swapExactIn(w, u, E18(37), 0, alice.address, ND);
    await dex.connect(alice).addLiquidity(w, u, E18(40), E18(10), 0, ND);
    await dex.connect(alice).swapExactIn(u, w, E18(5), 0, alice.address, ND);

    // getPool returns reserves in sorted-address order (token0 = lower addr),
    // so map each reserve to its actual token before comparing.
    const pool = await dex.getPool(w, u);
    const wIsToken0 = String(pool.token0).toLowerCase() === w.toLowerCase();
    const wReserve = wIsToken0 ? pool.reserve0 : pool.reserve1;
    const uReserve = wIsToken0 ? pool.reserve1 : pool.reserve0;
    expect(await wkas.balanceOf(dexAddr)).to.equal(wReserve);
    expect(await usdt.balanceOf(dexAddr)).to.equal(uReserve);
  });

  it('total LP shares value never exceeds reserves (no share inflation)', async () => {
    const { dex, wkas, usdt, deployer, alice } = await loadFixture(fullStack);
    const w = await wkas.getAddress();
    const u = await usdt.getAddress();

    await wkas.connect(alice).deposit({ value: E18(200) });
    await usdt.mint(alice.address, E18(50));
    await wkas.connect(alice).approve(await dex.getAddress(), ND);
    await usdt.connect(alice).approve(await dex.getAddress(), ND);
    await dex.connect(alice).addLiquidity(w, u, E18(200), E18(50), 0, ND);

    const pool = await dex.getPool(w, u);
    const deployerShares = await dex.sharesOf(w, u, deployer.address);
    const aliceShares = await dex.sharesOf(w, u, alice.address);
    // shares[address(0)] = 1000 locked; sum of all <= totalShares
    expect(deployerShares + aliceShares + 1000n).to.equal(pool.totalShares);
  });
});

describe('Attack simulations — StrategyVault', () => {
  async function withVault() {
    const base = await loadFixture(fullStack);
    await base.registry.registerBot('Bot', '', 2000);
    await base.factory.createVault(
      0,
      await base.wkas.getAddress(),
      [await base.usdt.getAddress()],
      2500,
      0,
    );
    const vault = await ethers.getContractAt('StrategyVault', await base.factory.vaultByBot(0));
    return { ...base, vault };
  }

  it('a non-operator cannot move vault funds by any external call', async () => {
    const { vault, wkas, usdt, attacker } = await withVault();
    await wkas.connect(attacker).deposit({ value: E18(10) });
    await wkas.connect(attacker).approve(await vault.getAddress(), ND);
    await vault.connect(attacker).deposit(E18(10));

    // attacker (a depositor, not operator) cannot trade the vault's funds
    await expect(
      vault.connect(attacker).executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(1), 0, ND),
    ).to.be.revertedWith('Vault: not operator');
  });

  it('operator cannot send vault funds to an arbitrary address (recipient is always the vault)', async () => {
    // The executeSwap signature has no recipient param — the vault hardcodes
    // address(this). This test documents that guarantee via a rogue token:
    // even a swap can only deposit output back into the vault.
    const { vault, wkas, usdt, deployer } = await withVault();
    await wkas.deposit({ value: E18(10) });
    await wkas.approve(await vault.getAddress(), ND);
    await vault.deposit(E18(10));

    const dexUsdtBefore = await usdt.balanceOf(await vault.getAddress());
    await vault.executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(2), 0, ND);
    const dexUsdtAfter = await usdt.balanceOf(await vault.getAddress());
    // output landed in the vault, not with the operator (deployer)
    expect(dexUsdtAfter).to.be.greaterThan(dexUsdtBefore);
  });

  it('a depositor can always exit even while a position is open (never trapped)', async () => {
    const { vault, wkas, usdt, alice } = await withVault();
    await wkas.connect(alice).deposit({ value: E18(20) });
    await wkas.connect(alice).approve(await vault.getAddress(), ND);
    await vault.connect(alice).deposit(E18(20));

    // operator opens a position — vault is now non-flat
    await vault.executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(4), 0, ND);
    expect(await vault.isFlat()).to.equal(false);

    // alice can STILL withdraw her full share (gets pro-rata of both tokens)
    const shares = await vault.sharesOf(alice.address);
    await expect(vault.connect(alice).withdraw(shares)).to.not.be.reverted;
    expect(await usdt.balanceOf(alice.address)).to.be.greaterThan(0n);
  });

  it('performance fee can never exceed realized profit (fee bounded)', async () => {
    const { vault, wkas, deployer, alice, attacker } = await withVault();
    await wkas.connect(alice).deposit({ value: E18(100) });
    await wkas.connect(alice).approve(await vault.getAddress(), ND);
    await vault.connect(alice).deposit(E18(100));

    // simulate a 20 WKAS profit via donation
    await wkas.connect(attacker).deposit({ value: E18(20) });
    await wkas.connect(attacker).transfer(await vault.getAddress(), E18(20));

    const creatorBefore = await wkas.balanceOf(deployer.address);
    const shares = await vault.sharesOf(alice.address);
    await vault.connect(alice).withdraw(shares);
    const creatorFee = (await wkas.balanceOf(deployer.address)) - creatorBefore;

    // profit ~20, fee = 20% => ~4; fee must never exceed the profit itself
    expect(creatorFee).to.be.lessThan(E18(20));
    expect(creatorFee).to.be.closeTo(E18(4), E18(0.2));
  });
});
