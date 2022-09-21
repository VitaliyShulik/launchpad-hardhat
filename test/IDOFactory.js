const { expect } = require("chai");

const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { ethers } = require("hardhat");
const {
  BigNumber,
  provider,
  getContractFactory,
  getContractAt,
  getSigners
} = ethers;

const feeAmount = "0"; // Claim fee amount number of feeTokens when create IDO.
const burnPercent = "0"; // Burn some percent of feeTokens when create IDO. Divider is 100.
const ether = BigNumber.from(10).pow(18);

const getTokenInfo = async (tokenContract) => {
  const name = await tokenContract.name();
  const symbol = await tokenContract.symbol();
  const decimals = await tokenContract.decimals();
  const denominator = BigNumber.from(10).pow(decimals)

  return {
    name,
    symbol,
    decimals,
    denominator,
  }

};

const createIDO = async (FeeToken, IDOFactory, LockerFactory, RewardToken) => {
    const rewardTokenInfo = await getTokenInfo(RewardToken);

    const tokenRate = BigNumber.from(1000); // Tokens per eth
    const listingRate = BigNumber.from(500); // Tokens per eth
    const liquidityPercentage = 60;
    const softCap = BigNumber.from(1); // in ETH
    const hardCap = BigNumber.from(2); // in ETH
    const minETHInvest = BigNumber.from(2);
    const maxETHInvest = BigNumber.from(2);

    const finInfo = [
      tokenRate.mul(rewardTokenInfo.denominator).toHexString(),
      softCap.mul(ether).toHexString(),
      hardCap.mul(ether).toHexString(),
      minETHInvest.div(ether).toHexString(), // use div 'cause I need to set 0.5 ETH as minETHInvest
      maxETHInvest.mul(ether).toHexString(),
      listingRate.mul(rewardTokenInfo.denominator).toHexString(),
      liquidityPercentage,
    ];

    const currentBlock = await provider.getBlock();
    const timestamps = [
      currentBlock.timestamp + 60, // start IDO
      currentBlock.timestamp + 120, // end IDO
      currentBlock.timestamp + 180, // unlock IDO tokens
    ];

    const dexInfo = [
      "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Router
      "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Factory
      "0xb4fbf271143f4fbf7b91a5ded31805e42b2208d6", // WETH
    ];

    const metadataURL = "https://test-ipfs.infura-ipfs.io/ipfs/QmYgpYtynEi6qaS4SkdmsdsAPLn6meLB4jqAir8gR52sm"; // Usually pinata url

    const IDOPoolTokenAmount = hardCap.mul(tokenRate);
    const LockedTokenAmount = hardCap.mul(liquidityPercentage).mul(listingRate).div(100);

    const requiredToken = IDOPoolTokenAmount.add(LockedTokenAmount).mul(rewardTokenInfo.denominator);

    // approve required amount of tokens to the IDOFactory
    await RewardToken.approve(IDOFactory.address, requiredToken.toHexString());

    const creatingTokenFee = await IDOFactory.feeAmount();
    if (creatingTokenFee.gt(0)) {
      await FeeToken.approve(IDOFactory.address, creatingTokenFee.toHexString())
    }

    let tx = await IDOFactory.createIDO(
      RewardToken.address,
      finInfo,
      timestamps,
      dexInfo,
      LockerFactory.address,
      metadataURL
    );

    tx = await tx.wait();

    return getContractAt("IDOPool", tx.logs[0].address);
}

describe("IDOFactory contract", function () {
  async function deployIDOPoolFixture() {
    const [owner, addr1, addr2] = await getSigners();

    const FeeTokenFactory = await getContractFactory("FeeToken");
    const FeeToken = await FeeTokenFactory.deploy();
    await FeeToken.deployed();

    const hardhatIDOFactory = await getContractFactory("IDOFactory");
    const IDOFactory = await hardhatIDOFactory.deploy(FeeToken.address, feeAmount, burnPercent);
    await IDOFactory.deployed();

    const hardhatLockerFactory = await getContractFactory("TokenLockerFactory");
    const LockerFactory = await hardhatLockerFactory.deploy();
    await LockerFactory.deployed();

    const RewardTokenFactory = await getContractFactory("RewardToken");
    const RewardToken = await RewardTokenFactory.deploy();
    await RewardToken.deployed();

    return {
      IDOFactory,
      LockerFactory,
      RewardToken,
      FeeToken,
      owner, addr1, addr2,
    };
  }
  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { IDOFactory, LockerFactory, owner } = await loadFixture(deployIDOPoolFixture);

      expect(await IDOFactory.owner()).to.equal(owner.address);
      expect(await LockerFactory.owner()).to.equal(owner.address);

    });

    it("Should be set up all the props by default", async function () {
      const { IDOFactory, LockerFactory, FeeToken } = await loadFixture(deployIDOPoolFixture);

      expect(await IDOFactory.feeToken()).to.equal(FeeToken.address);
      expect(await IDOFactory.feeAmount()).to.equal(feeAmount);
      expect(await IDOFactory.burnPercent()).to.equal(burnPercent);
      expect(await LockerFactory.fee()).to.equal(0);
    });

    it("Should create a IDOPoll with right owner", async function () {
      const { FeeToken, IDOFactory, LockerFactory, RewardToken, owner } = await loadFixture(deployIDOPoolFixture);

      const IDOPoolContract = await createIDO(FeeToken, IDOFactory, LockerFactory, RewardToken);

      expect(await IDOPoolContract.owner()).to.equal(owner.address);
    });

    it("Should burnFrom owner account 1000 tokens with addr1 allowance", async function () {
      const { FeeToken, owner, addr1 } = await loadFixture(deployIDOPoolFixture);

      const tokenInfo = await getTokenInfo(FeeToken);

      const tokenAmountForBurn = tokenInfo.denominator.mul(1000);
      const totalSupply = await FeeToken.totalSupply();

      await FeeToken.approve(addr1.address, tokenAmountForBurn)

      await FeeToken.connect(addr1).burnFrom(owner.address, tokenAmountForBurn);

      const totalSupplyAfterBurn = await FeeToken.totalSupply();

      expect(totalSupply.sub(tokenAmountForBurn)).to.equal(totalSupplyAfterBurn);
    });

  });

  describe("Check IDO pools", function () {

    it("Should Invest ETH, Reach hard cap, Claim tokens, Lock LP tokens and witdraw rest ETH without LockerFee", async function () {
      const { FeeToken, IDOFactory, LockerFactory, RewardToken, owner, addr1 } = await loadFixture(deployIDOPoolFixture);

      const IDOPoolContract = await createIDO(FeeToken, IDOFactory, LockerFactory, RewardToken);

      // advance time by one minute and mine a new block to start IDO
      await time.increase(60);

      // buy 2000 tokens for 2 Ethers and reach hard cap
      const ethForPayment = ether.mul(2).toHexString();
      await IDOPoolContract.connect(addr1).pay({ value: ethForPayment });

      // Invest ETH and check invested ETH
      const IDOUserInfo = await IDOPoolContract.userInfo(addr1.address)
      expect(IDOUserInfo.totalInvestedETH.toHexString()).to.equal(ethForPayment);

      // Check IDO hard cap has reached
      const IDOFinInfo = await IDOPoolContract.finInfo();
      expect(IDOFinInfo.hardCap).to.equal(await IDOPoolContract.totalInvestedETH());

      // advance time by one minute and mine a new block to end IDO
      await time.increase(60);

      // Claim tokens and check balance of addr1
      await IDOPoolContract.connect(addr1).claim();
      expect(IDOUserInfo.total).to.equal(await RewardToken.balanceOf(addr1.address));

      // Lock LP tokens and witdraw rest ETH with withdrawETH methods
      const tx = await IDOPoolContract.withdrawETH();
      const withdrawETHtx = await tx.wait();
      console.log('lockerAddress', withdrawETHtx.events[12].address); // 12 index interacts with lockerAddress
      console.log('lpTokenAddress', withdrawETHtx.events[13].address); // 13 index interacts with lpTokenAddress

    });

    it("Should Invest ETH, Reach hard cap, Claim tokens, Lock LP tokens and witdraw rest ETH with LockerFee", async function () {
      const { FeeToken, IDOFactory, LockerFactory, RewardToken, owner, addr1 } = await loadFixture(deployIDOPoolFixture);

      const IDOPoolContract = await createIDO(FeeToken, IDOFactory, LockerFactory, RewardToken);

      const lockerFeeETH = ether.mul(1).toHexString();
      await LockerFactory.setFee(lockerFeeETH);

      // advance time by one minute and mine a new block to start IDO
      await time.increase(60);

      // buy 2000 tokens for 2 Ethers and reach hard cap
      const ethForPayment = ether.mul(2).toHexString();
      await IDOPoolContract.connect(addr1).pay({ value: ethForPayment });

      // Invest ETH and check invested ETH
      const IDOUserInfo = await IDOPoolContract.userInfo(addr1.address)
      expect(IDOUserInfo.totalInvestedETH.toHexString()).to.equal(ethForPayment);

      // Check IDO hard cap has reached
      const IDOFinInfo = await IDOPoolContract.finInfo();
      expect(IDOFinInfo.hardCap).to.equal(await IDOPoolContract.totalInvestedETH());

      // advance time by one minute and mine a new block to end IDO
      await time.increase(60);

      // Claim tokens and check balance of addr1
      await IDOPoolContract.connect(addr1).claim();
      expect(IDOUserInfo.total).to.equal(await RewardToken.balanceOf(addr1.address));

      // Lock LP tokens and witdraw rest ETH with withdrawETH methods
      const tx = await IDOPoolContract.withdrawETH({ value: lockerFeeETH });
      const withdrawETHtx = await tx.wait();
      console.log('lockerAddress', withdrawETHtx.events[12].address); // 12 index interacts with lockerAddress
      console.log('lpTokenAddress', withdrawETHtx.events[13].address); // 13 index interacts with lpTokenAddress

      // Check create Locker fee
      expect(await provider.getBalance(LockerFactory.address)).to.equal(lockerFeeETH);

    });

    it("Creating and interacting with IDOPool with a token fee", async function () {
      const { FeeToken, IDOFactory, LockerFactory, RewardToken, addr2, addr1 } = await loadFixture(deployIDOPoolFixture);

      // Set create IDO fee
      const feeTokenInfo = await getTokenInfo(FeeToken);

      const newBurnPercent = BigNumber.from("15");
      const newDivider = BigNumber.from("100");
      const createIDOFeeAmount = feeTokenInfo.denominator.mul(5)
      const burnTokenAmount = createIDOFeeAmount.mul(newBurnPercent).div(newDivider);

      await IDOFactory.setBurnPercent(newBurnPercent, newDivider);
      await IDOFactory.setFeeAmount(createIDOFeeAmount);
      await IDOFactory.setFeeWallet(addr2.address);

      // Create IDO
      const IDOPoolContract = await createIDO(FeeToken, IDOFactory, LockerFactory, RewardToken);

      // Checking create IDO fee
      expect(await FeeToken.balanceOf(addr2.address)).to.equal(createIDOFeeAmount.sub(burnTokenAmount));

      // advance time by one minute and mine a new block to start IDO
      await time.increase(60);

      // buy 2000 tokens for 2 Ethers and reach hard cap
      const ethForPayment = ether.mul(2).toHexString();
      await IDOPoolContract.connect(addr1).pay({ value: ethForPayment });

      // Invest ETH and check invested ETH
      const IDOUserInfo = await IDOPoolContract.userInfo(addr1.address)
      expect(IDOUserInfo.totalInvestedETH.toHexString()).to.equal(ethForPayment);

      // Check IDO hard cap has reached
      const IDOFinInfo = await IDOPoolContract.finInfo();
      expect(IDOFinInfo.hardCap).to.equal(await IDOPoolContract.totalInvestedETH());

      // advance time by one minute and mine a new block to end IDO
      await time.increase(60);

      // Claim tokens and check balance of addr1
      await IDOPoolContract.connect(addr1).claim();
      expect(IDOUserInfo.total).to.equal(await RewardToken.balanceOf(addr1.address));

      // Lock LP tokens and witdraw rest ETH with withdrawETH methods
      const tx = await IDOPoolContract.withdrawETH();
      const withdrawETHtx = await tx.wait();
      console.log('lockerAddress', withdrawETHtx.events[12].address); // 12 index interacts with lockerAddress
      console.log('lpTokenAddress', withdrawETHtx.events[13].address); // 13 index interacts with lpTokenAddress

    });

    it("Creating and interacting with IDOPool with a token fee and create Locker fee", async function () {
      const { FeeToken, IDOFactory, LockerFactory, RewardToken, addr2, addr1 } = await loadFixture(deployIDOPoolFixture);

      // Set create IDO fee
      const feeTokenInfo = await getTokenInfo(FeeToken);

      const newBurnPercent = BigNumber.from("15");
      const newDivider = BigNumber.from("100");
      const createIDOFeeAmount = feeTokenInfo.denominator.mul(5)
      const burnTokenAmount = createIDOFeeAmount.mul(newBurnPercent).div(newDivider);

      await IDOFactory.setBurnPercent(newBurnPercent, newDivider);
      await IDOFactory.setFeeAmount(createIDOFeeAmount);
      await IDOFactory.setFeeWallet(addr2.address);

      // Set create Locker fee
      const lockerFeeETH = ether.mul(1).toHexString();
      await LockerFactory.setFee(lockerFeeETH)

      // Create ICO
      const IDOPoolContract = await createIDO(FeeToken, IDOFactory, LockerFactory, RewardToken);

      // Checking create IDO fee
      expect(await FeeToken.balanceOf(addr2.address)).to.equal(createIDOFeeAmount.sub(burnTokenAmount));

      // advance time by one minute and mine a new block to start IDO
      await time.increase(60);

      // buy 2000 tokens for 2 Ethers and reach hard cap
      const ethForPayment = ether.mul(2).toHexString();
      await IDOPoolContract.connect(addr1).pay({ value: ethForPayment });

      // Invest ETH and check invested ETH
      const IDOUserInfo = await IDOPoolContract.userInfo(addr1.address)
      expect(IDOUserInfo.totalInvestedETH.toHexString()).to.equal(ethForPayment);

      // Check IDO hard cap has reached
      const IDOFinInfo = await IDOPoolContract.finInfo();
      expect(IDOFinInfo.hardCap).to.equal(await IDOPoolContract.totalInvestedETH());

      // advance time by one minute and mine a new block to end IDO
      await time.increase(60);

      // Claim tokens and check balance of addr1
      await IDOPoolContract.connect(addr1).claim();
      expect(IDOUserInfo.total).to.equal(await RewardToken.balanceOf(addr1.address));

      // Lock LP tokens and witdraw rest ETH with withdrawETH methods
      const tx = await IDOPoolContract.withdrawETH({ value: lockerFeeETH });
      const withdrawETHtx = await tx.wait();
      console.log('lockerAddress', withdrawETHtx.events[12].address); // 12 index interacts with lockerAddress
      console.log('lpTokenAddress', withdrawETHtx.events[13].address); // 13 index interacts with lpTokenAddress

      // Check create Locker fee
      expect(await provider.getBalance(LockerFactory.address)).to.equal(lockerFeeETH);

    });

  });

});