const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

const E18 = (n) => ethers.parseEther(String(n));
const NO_DEADLINE = ethers.MaxUint256;

describe('KasDex', () => {
  let dex, wkas, usdt, deployer, trader;

  async function deployDexFixture() {
    const [deployer, trader] = await ethers.getSigners();

    const dex = await (await ethers.getContractFactory('KasDex')).deploy();
    const wkas = await (await ethers.getContractFactory('WKAS')).deploy();
    const usdt = await (await ethers.getContractFactory('MockERC20')).deploy('Test USDT', 'tUSDT');

    // deployer: wrap 5,000 KAS (accounts hold 10,000 native incl. gas), mint 10,000 tUSDT
    await wkas.deposit({ value: E18(5_000) });
    await usdt.mint(deployer.address, E18(10_000));
    await wkas.approve(await dex.getAddress(), ethers.MaxUint256);
    await usdt.approve(await dex.getAddress(), ethers.MaxUint256);

    await dex.createPool(await wkas.getAddress(), await usdt.getAddress(), 30);
    // seed 4000 WKAS : 1000 tUSDT (1 KAS = 0.25 USDT)
    await dex.addLiquidity(await wkas.getAddress(), await usdt.getAddress(), E18(4_000), E18(1_000), 0, NO_DEADLINE);

    return { dex, wkas, usdt, deployer, trader };
  }

  beforeEach(async () => {
    ({ dex, wkas, usdt, deployer, trader } = await loadFixture(deployDexFixture));
  });

  it('creates pools with sorted tokens and rejects duplicates', async () => {
    expect(await dex.poolCount()).to.equal(1n);
    await expect(
      dex.createPool(await usdt.getAddress(), await wkas.getAddress(), 30),
    ).to.be.revertedWith('KasDex: pool exists');
  });

  it('restricts pool creation to the owner', async () => {
    const other = await (await ethers.getContractFactory('MockERC20')).deploy('X', 'X');
    await expect(
      dex.connect(trader).createPool(await other.getAddress(), await usdt.getAddress(), 30),
    ).to.be.revertedWithCustomError(dex, 'OwnableUnauthorizedAccount');
  });

  it('quotes with the constant-product formula including fee', async () => {
    const amountIn = E18(100);
    const out = await dex.getAmountOut(await wkas.getAddress(), await usdt.getAddress(), amountIn);
    // x=4000, y=1000, fee 0.3%: out = 99.7*1000 / (4000+99.7) ≈ 24.32
    expect(out).to.be.closeTo(E18(24.32), E18(0.01));
  });

  it('swaps in both directions and moves reserves', async () => {
    const wkasAddr = await wkas.getAddress();
    const usdtAddr = await usdt.getAddress();

    await wkas.connect(trader).deposit({ value: E18(100) });
    await wkas.connect(trader).approve(await dex.getAddress(), ethers.MaxUint256);

    const quoted = await dex.getAmountOut(wkasAddr, usdtAddr, E18(100));
    await dex.connect(trader).swapExactIn(wkasAddr, usdtAddr, E18(100), quoted, trader.address, NO_DEADLINE);
    expect(await usdt.balanceOf(trader.address)).to.equal(quoted);

    // reverse direction with the received tUSDT
    await usdt.connect(trader).approve(await dex.getAddress(), ethers.MaxUint256);
    const back = await dex.getAmountOut(usdtAddr, wkasAddr, quoted);
    await dex.connect(trader).swapExactIn(usdtAddr, wkasAddr, quoted, back, trader.address, NO_DEADLINE);

    // round trip must lose ~2x fee — never profit
    expect(back).to.be.lessThan(E18(100));
    expect(back).to.be.greaterThan(E18(98));
  });

  it('enforces minAmountOut slippage protection', async () => {
    const wkasAddr = await wkas.getAddress();
    const usdtAddr = await usdt.getAddress();
    const quoted = await dex.getAmountOut(wkasAddr, usdtAddr, E18(100));

    await expect(
      dex.swapExactIn(wkasAddr, usdtAddr, E18(100), quoted + 1n, deployer.address, NO_DEADLINE),
    ).to.be.revertedWith('KasDex: slippage');
  });

  it('rejects expired deadlines', async () => {
    await expect(
      dex.swapExactIn(await wkas.getAddress(), await usdt.getAddress(), E18(1), 0, deployer.address, 1),
    ).to.be.revertedWith('KasDex: expired');
    await expect(
      dex.addLiquidity(await wkas.getAddress(), await usdt.getAddress(), E18(1), E18(1), 0, 1),
    ).to.be.revertedWith('KasDex: expired');
  });

  it('rejects swaps that would round output to zero', async () => {
    await expect(
      dex.swapExactIn(await wkas.getAddress(), await usdt.getAddress(), 1n, 0, deployer.address, NO_DEADLINE),
    ).to.be.revertedWith('KasDex: zero output');
  });

  it('mints and burns LP shares proportionally', async () => {
    const wkasAddr = await wkas.getAddress();
    const usdtAddr = await usdt.getAddress();

    const sharesBefore = await dex.sharesOf(wkasAddr, usdtAddr, deployer.address);
    expect(sharesBefore).to.be.greaterThan(0n);

    // add 10% more at the same ratio → ~10% more shares
    await dex.addLiquidity(wkasAddr, usdtAddr, E18(400), E18(100), 0, NO_DEADLINE);
    const sharesAfter = await dex.sharesOf(wkasAddr, usdtAddr, deployer.address);
    const minted = sharesAfter - sharesBefore;
    expect(minted).to.be.closeTo(sharesBefore / 10n, sharesBefore / 1000n);

    // remove what we just added
    const balBefore = await usdt.balanceOf(deployer.address);
    await dex.removeLiquidity(wkasAddr, usdtAddr, minted, 0, 0, NO_DEADLINE);
    const balAfter = await usdt.balanceOf(deployer.address);
    expect(balAfter - balBefore).to.be.closeTo(E18(100), E18(1));
  });

  it('trims off-ratio liquidity instead of donating the excess', async () => {
    const wkasAddr = await wkas.getAddress();
    const usdtAddr = await usdt.getAddress();

    // pool ratio is 4:1 — offering 400 WKAS with 200 tUSDT should only take 100 tUSDT
    const usdtBefore = await usdt.balanceOf(deployer.address);
    await dex.addLiquidity(wkasAddr, usdtAddr, E18(400), E18(200), 0, NO_DEADLINE);
    const usdtTaken = usdtBefore - (await usdt.balanceOf(deployer.address));
    expect(usdtTaken).to.equal(E18(100));
  });

  it('locks MINIMUM_LIQUIDITY on first mint', async () => {
    const wkasAddr = await wkas.getAddress();
    const usdtAddr = await usdt.getAddress();
    const [, , , , totalShares] = await dex.getPool(wkasAddr, usdtAddr);
    const mine = await dex.sharesOf(wkasAddr, usdtAddr, deployer.address);
    expect(totalShares - mine).to.equal(1000n); // shares[address(0)]
  });

  it('keeps reserves equal to actual holdings for fee-on-transfer tokens', async () => {
    const fee = await (await ethers.getContractFactory('FeeOnTransferMock')).deploy();
    const feeAddr = await fee.getAddress();
    const usdtAddr = await usdt.getAddress();
    const dexAddr = await dex.getAddress();

    await fee.approve(dexAddr, ethers.MaxUint256);
    await dex.createPool(feeAddr, usdtAddr, 30);
    await dex.addLiquidity(feeAddr, usdtAddr, E18(1_000), E18(1_000), 0, NO_DEADLINE);

    // reserves must reflect the post-fee amount actually received (2% skimmed)
    const [token0, , reserve0, reserve1] = await dex.getPool(feeAddr, usdtAddr);
    const feeReserve = token0.toLowerCase() === feeAddr.toLowerCase() ? reserve0 : reserve1;
    expect(feeReserve).to.equal(E18(980));
    expect(await fee.balanceOf(dexAddr)).to.equal(feeReserve);

    // a swap in of the fee token also credits only what arrived
    await dex.swapExactIn(feeAddr, usdtAddr, E18(100), 0, deployer.address, NO_DEADLINE);
    const [t0after, , r0after, r1after] = await dex.getPool(feeAddr, usdtAddr);
    const feeReserveAfter = t0after.toLowerCase() === feeAddr.toLowerCase() ? r0after : r1after;
    expect(await fee.balanceOf(dexAddr)).to.equal(feeReserveAfter);
  });
});

describe('BotRegistry', () => {
  let registry, creator, trader;

  beforeEach(async () => {
    [creator, trader] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory('BotRegistry')).deploy();
  });

  it('registers bots and reads them back', async () => {
    await registry.registerBot('Grid Bot', 'ipfs://strategy.json', 1500);
    expect(await registry.botCount()).to.equal(1n);

    const bot = await registry.getBot(0);
    expect(bot.name).to.equal('Grid Bot');
    expect(bot.feeBps).to.equal(1500);
    expect(bot.active).to.equal(true);
    expect(bot.creator).to.equal(creator.address);
  });

  it('rejects excessive fees and oversized URIs', async () => {
    await expect(registry.registerBot('Greedy', '', 3001)).to.be.revertedWith('BotRegistry: fee too high');
    await expect(registry.registerBot('Bloater', 'x'.repeat(513), 1000)).to.be.revertedWith('BotRegistry: URI too long');
  });

  it('handles subscribe/unsubscribe with counts', async () => {
    await registry.registerBot('Grid Bot', '', 1000);

    await registry.connect(trader).subscribe(0);
    expect((await registry.getBot(0)).subscriberCount).to.equal(1);
    await expect(registry.connect(trader).subscribe(0)).to.be.revertedWith('BotRegistry: already subscribed');

    await registry.connect(trader).unsubscribe(0);
    expect((await registry.getBot(0)).subscriberCount).to.equal(0);
  });

  it('only the creator manages the bot', async () => {
    await registry.registerBot('Grid Bot', '', 1000);
    await expect(registry.connect(trader).setActive(0, false)).to.be.revertedWith('BotRegistry: not creator');
    await expect(registry.connect(trader).setFee(0, 500)).to.be.revertedWith('BotRegistry: not creator');
  });

  it('blocks subscribing to inactive bots', async () => {
    await registry.registerBot('Grid Bot', '', 1000);
    await registry.setActive(0, false);
    await expect(registry.connect(trader).subscribe(0)).to.be.revertedWith('BotRegistry: inactive');
  });
});
