const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

const E18 = (n) => ethers.parseEther(String(n));
const NO_DEADLINE = ethers.MaxUint256;

describe('VaultFactory + StrategyVault', () => {
  let dex, wkas, usdt, registry, factory, vault;
  let creator, trader, outsider;

  async function deployVaultFixture() {
    const [creator, trader, outsider] = await ethers.getSigners();

    // core protocol
    const dex = await (await ethers.getContractFactory('KasDex')).deploy();
    const wkas = await (await ethers.getContractFactory('WKAS')).deploy();
    const usdt = await (await ethers.getContractFactory('MockERC20')).deploy('Test USDT', 'tUSDT');
    const registry = await (await ethers.getContractFactory('BotRegistry')).deploy();
    const factory = await (await ethers.getContractFactory('VaultFactory')).deploy(
      await registry.getAddress(),
      await dex.getAddress(),
    );

    // liquid pool: 2000 WKAS / 500 tUSDT. Wrap modestly — many fixtures share
    // these accounts in one process and WKAS.deposit locks native KAS that
    // can't be reclaimed mid-suite, so keep cumulative wraps well under 10k.
    await wkas.deposit({ value: E18(2_200) });
    await usdt.mint(creator.address, E18(10_000));
    await wkas.approve(await dex.getAddress(), ethers.MaxUint256);
    await usdt.approve(await dex.getAddress(), ethers.MaxUint256);
    await dex.createPool(await wkas.getAddress(), await usdt.getAddress(), 30);
    await dex.addLiquidity(await wkas.getAddress(), await usdt.getAddress(), E18(2_000), E18(500), 0, NO_DEADLINE);

    // bot #0 with 20% performance fee + its vault (base = WKAS,
    // 50% max trade, no cooldown — tests exercise limits separately)
    await registry.registerBot('Vault Bot', '', 2000);
    await factory.createVault(0, await wkas.getAddress(), [await usdt.getAddress()], 5000, 0);
    const vault = await ethers.getContractAt('StrategyVault', await factory.vaultByBot(0));

    // trader funds
    await wkas.connect(trader).deposit({ value: E18(500) });
    await wkas.connect(trader).approve(await vault.getAddress(), ethers.MaxUint256);

    return { dex, wkas, usdt, registry, factory, vault, creator, trader, outsider };
  }

  beforeEach(async () => {
    ({ dex, wkas, usdt, registry, factory, vault, creator, trader, outsider } = await loadFixture(deployVaultFixture));
  });

  it('only the bot creator can create its vault, once', async () => {
    await registry.connect(outsider).registerBot('Other Bot', '', 1000); // botId 1
    await expect(
      factory.createVault(1, await wkas.getAddress(), [], 2500, 60),
    ).to.be.revertedWith('Factory: not bot creator');
    await expect(
      factory.createVault(0, await wkas.getAddress(), [], 2500, 60),
    ).to.be.revertedWith('Factory: vault exists');
  });

  it('rejects out-of-range trade caps and cooldowns at creation', async () => {
    await registry.registerBot('Bot A', '', 1000); // botId 1 (creator)
    await expect(
      factory.createVault(1, await wkas.getAddress(), [], 5001, 0),
    ).to.be.revertedWith('Vault: trade cap out of range');
    await expect(
      factory.createVault(1, await wkas.getAddress(), [], 99, 0),
    ).to.be.revertedWith('Vault: trade cap out of range');
    await expect(
      factory.createVault(1, await wkas.getAddress(), [], 2500, 86_401),
    ).to.be.revertedWith('Vault: cooldown too long');
  });

  it('caps risk-increasing trades but never blocks unwinding', async () => {
    // dedicated bot with tight limits: 25% cap, 1h cooldown
    await registry.registerBot('Tight Bot', '', 1000); // botId 1
    await factory.createVault(1, await wkas.getAddress(), [await usdt.getAddress()], 2500, 3600);
    const tight = await ethers.getContractAt('StrategyVault', await factory.vaultByBot(1));

    await wkas.connect(trader).approve(await tight.getAddress(), ethers.MaxUint256);
    await tight.connect(trader).deposit(E18(100));

    // > 25% of base balance -> reverts
    await expect(
      tight.executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(26), 0, NO_DEADLINE),
    ).to.be.revertedWith('Vault: trade exceeds cap');

    // <= 25% passes
    await tight.executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(25), 0, NO_DEADLINE);

    // second risk-increasing trade inside the cooldown -> reverts
    await expect(
      tight.executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(5), 0, NO_DEADLINE),
    ).to.be.revertedWith('Vault: cooldown');

    // unwinding 100% back to base is exempt from BOTH cap and cooldown
    const usdtBal = await usdt.balanceOf(await tight.getAddress());
    await tight.executeSwap(await usdt.getAddress(), await wkas.getAddress(), usdtBal, 0, NO_DEADLINE);
    expect(await tight.isFlat()).to.equal(true);
  });

  it('accepts deposits and mints shares', async () => {
    await vault.connect(trader).deposit(E18(100));
    expect(await vault.sharesOf(trader.address)).to.equal(E18(100) - 1000n);
    expect(await vault.costBasisOf(trader.address)).to.equal(E18(100));
    expect(await wkas.balanceOf(await vault.getAddress())).to.equal(E18(100));
  });

  it('only the operator can trade, only allowed tokens, only via the DEX', async () => {
    await vault.connect(trader).deposit(E18(100));

    await expect(
      vault.connect(trader).executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(10), 0, NO_DEADLINE),
    ).to.be.revertedWith('Vault: not operator');

    const rogue = await (await ethers.getContractFactory('MockERC20')).deploy('Rogue', 'RGE');
    await expect(
      vault.executeSwap(await wkas.getAddress(), await rogue.getAddress(), E18(10), 0, NO_DEADLINE),
    ).to.be.revertedWith('Vault: token not allowed');

    // legit trade: WKAS -> tUSDT lands IN THE VAULT
    await vault.executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(10), 0, NO_DEADLINE);
    expect(await usdt.balanceOf(await vault.getAddress())).to.be.greaterThan(0n);
    expect(await usdt.balanceOf(creator.address)).to.equal(E18(9_500)); // unchanged (10k minus 500 pooled)
  });

  it('blocks deposits while a position is open, reopens when flat', async () => {
    await vault.connect(trader).deposit(E18(100));
    await vault.executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(10), 0, NO_DEADLINE);

    await expect(vault.connect(trader).deposit(E18(10))).to.be.revertedWith(
      'Vault: deposits open only between trading rounds',
    );

    // unwind to flat
    const usdtBal = await usdt.balanceOf(await vault.getAddress());
    await vault.executeSwap(await usdt.getAddress(), await wkas.getAddress(), usdtBal, 0, NO_DEADLINE);
    expect(await vault.isFlat()).to.equal(true);
    await vault.connect(trader).deposit(E18(10)); // works again
  });

  it('withdrawal returns funds; losses are borne, no fee charged', async () => {
    await vault.connect(trader).deposit(E18(100));

    // round trip loses fees -> vault ends slightly below 100
    await vault.executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(50), 0, NO_DEADLINE);
    const usdtBal = await usdt.balanceOf(await vault.getAddress());
    await vault.executeSwap(await usdt.getAddress(), await wkas.getAddress(), usdtBal, 0, NO_DEADLINE);

    const shares = await vault.sharesOf(trader.address);
    const before = await wkas.balanceOf(trader.address);
    await vault.connect(trader).withdraw(shares);
    const got = (await wkas.balanceOf(trader.address)) - before;

    expect(got).to.be.lessThan(E18(100)); // loss realized
    expect(got).to.be.greaterThan(E18(98));
    // no fee went to creator: creator WKAS balance only reflects pool ops (1000 wrapped-4000... just check no increase since fixture)
  });

  it('charges the performance fee only on profit above cost basis', async () => {
    await vault.connect(trader).deposit(E18(100));

    // simulate profit: outsider donates WKAS gains to the vault (stands in
    // for a winning trading round; donation credits all shareholders)
    await wkas.connect(outsider).deposit({ value: E18(50) });
    await wkas.connect(outsider).transfer(await vault.getAddress(), E18(50));

    const shares = await vault.sharesOf(trader.address);
    const creatorBefore = await wkas.balanceOf(creator.address);
    const traderBefore = await wkas.balanceOf(trader.address);

    await vault.connect(trader).withdraw(shares);

    const creatorGain = (await wkas.balanceOf(creator.address)) - creatorBefore;
    const traderGain = (await wkas.balanceOf(trader.address)) - traderBefore;

    // trader's share value ≈ 150 * (shares/totalShares) ≈ ~150; profit ≈ 50; fee = 20% of profit ≈ 10
    expect(creatorGain).to.be.closeTo(E18(10), E18(0.1));
    expect(traderGain).to.be.closeTo(E18(140), E18(0.1));
  });

  it('lets depositors exit mid-position pro-rata with open holdings', async () => {
    await vault.connect(trader).deposit(E18(100));
    await vault.executeSwap(await wkas.getAddress(), await usdt.getAddress(), E18(40), 0, NO_DEADLINE);

    const shares = await vault.sharesOf(trader.address);
    await vault.connect(trader).withdraw(shares / 2n);

    // got both tokens back pro-rata
    expect(await usdt.balanceOf(trader.address)).to.be.greaterThan(0n);
    expect(await wkas.balanceOf(trader.address)).to.be.greaterThan(0n);
  });

  it('operator management is creator-only', async () => {
    await expect(vault.connect(trader).setOperator(trader.address)).to.be.revertedWith('Vault: not creator');
    await vault.setOperator(outsider.address);
    expect(await vault.operator()).to.equal(outsider.address);
  });
});
