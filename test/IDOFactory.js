const { expect } = require("chai");

const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { ethers } = require("hardhat");

const feeToken = "0x7ed59478Dd0c9C8417b64FC4f10e4F9cCA9C41e4"; // Openzeppelin ERC20Burnable token address.
const feeAmount = "0"; // Claim fee amount number of feeTokens when create IDO.
const burnPercent = "0"; // Burn some percent of feeTokens when create IDO. Divider is 100.
const ether = ethers.BigNumber.from(10).pow(18);

const createIDO = async (IDOFactoryContract, hardhatLockerFactory, rewardTokenContract) => {
    const { provider, BigNumber, getContractAt } = ethers;

    const decimals = await rewardTokenContract.decimals()

    const tokenRate = BigNumber.from(1000); // Tokens per eth
    const listingRate = BigNumber.from(500); // Tokens per eth
    const liquidityPercentage = 60;
    const softCap = BigNumber.from(1); // in ETH
    const hardCap = BigNumber.from(2); // in ETH
    const minETHInvest = BigNumber.from(2);
    const maxETHInvest = BigNumber.from(2);

    const tokenDenominator = BigNumber.from(10).pow(decimals);

    const capacity = [
      softCap.mul(ether).toHexString(),
      hardCap.mul(ether).toHexString(),
      minETHInvest.div(ether).toHexString(), // use div 'cause I need to set 0.5 ETH as minETHInvest
      maxETHInvest.mul(ether).toHexString(),
    ];

    const currentBlock = await provider.getBlock();
    const time = [
      currentBlock.timestamp + 60, // start IDO
      currentBlock.timestamp + 120, // stop IDO
      currentBlock.timestamp + 180, // unlock IDO tokens
    ];

    const uniswap = [
      "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Router
      "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", // Factory
      "0xb4fbf271143f4fbf7b91a5ded31805e42b2208d6", // WETH
    ];

    const lockInfo = [
      liquidityPercentage,
      hardhatLockerFactory.address,
    ];

    const IDOMetadataURL = "https://test-ipfs.infura-ipfs.io/ipfs/QmYgpYtynEi6qaS4SkdmsdsAPLn6meLB4jqAir8gR52sm"; // Usually pinata url

    const IDOPoolTokenAmount = hardCap.mul(tokenRate);
    const LockedTokenAmount = hardCap.mul(liquidityPercentage).mul(listingRate).div(100);

    const requiredToken = IDOPoolTokenAmount.add(LockedTokenAmount).mul(tokenDenominator);

    // approve required amount of tokens to the IDOFactory
    await rewardTokenContract.approve(IDOFactoryContract.address, requiredToken.toHexString());

    let tx = await IDOFactoryContract.createIDO(
      rewardTokenContract.address,
      tokenRate.mul(tokenDenominator).toHexString(),
      listingRate.mul(tokenDenominator).toHexString(),
      capacity,
      time,
      uniswap,
      lockInfo,
      IDOMetadataURL
    );

    tx = await tx.wait();

    return getContractAt("IDOPool", tx.logs[0].address);
}

describe("IDOFactory contract", function () {
  async function deployIDOPoolFixture() {
    const [owner, addr1, addr2] = await ethers.getSigners();

    const IDOFactory = await ethers.getContractFactory("IDOFactory");
    const hardhatIDOFactory = await IDOFactory.deploy(feeToken, feeAmount, burnPercent);
    await hardhatIDOFactory.deployed();

    const LockerFactory = await ethers.getContractFactory("TokenLockerFactory");
    const hardhatLockerFactory = await LockerFactory.deploy();
    await hardhatLockerFactory.deployed();

    const RewardToken = await ethers.getContractFactory("RewardToken");
    const rewardTokenContract = await RewardToken.deploy();
    await rewardTokenContract.deployed();

    const IDOPoolContract = await createIDO(hardhatIDOFactory, hardhatLockerFactory, rewardTokenContract);

    return {
      IDOFactory,
      hardhatIDOFactory,
      LockerFactory,
      hardhatLockerFactory,
      RewardToken,
      rewardTokenContract,
      IDOPoolContract,
      owner, addr1, addr2,
    };
  }
  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { hardhatIDOFactory, hardhatLockerFactory, IDOPoolContract, owner } = await loadFixture(deployIDOPoolFixture);

      expect(await hardhatIDOFactory.owner()).to.equal(owner.address);
      expect(await hardhatLockerFactory.owner()).to.equal(owner.address);
      expect(await IDOPoolContract.owner()).to.equal(owner.address);

    });

    it("Should be set up all the props by default", async function () {
      const { hardhatIDOFactory, hardhatLockerFactory } = await loadFixture(deployIDOPoolFixture);

      expect(await hardhatIDOFactory.feeToken()).to.equal(feeToken);
      expect(await hardhatIDOFactory.feeAmount()).to.equal(feeAmount);
      expect(await hardhatIDOFactory.burnPercent()).to.equal(burnPercent);
      expect(await hardhatLockerFactory.fee()).to.equal(0);
    });
  });

  describe("Check IDO pools", function () {
    it("Should Invest ETH, Reach hard cap, Claim tokens, Lock LP tokens and witdraw rest ETH without LockerFee", async function () {
      const { IDOPoolContract, hardhatLockerFactory, rewardTokenContract, owner, addr1 } = await loadFixture(deployIDOPoolFixture);

      // advance time by one minute and mine a new block to start IDO
      await time.increase(60);

      // buy 2000 tokens for 2 Ethers and reach hard cap
      const ethForPayment = ether.mul(2).toHexString();
      await IDOPoolContract.connect(addr1).pay({ value: ethForPayment });

      // Invest ETH and check invested ETH
      const IDOUserInfo = await IDOPoolContract.userInfo(addr1.address)
      expect(IDOUserInfo.totalInvestedETH.toHexString()).to.equal(ethForPayment);

      // Check IDO hard cap has reached
      const IDOCapacity = await IDOPoolContract.capacity();
      expect(IDOCapacity.hardCap).to.equal(await IDOPoolContract.totalInvestedETH());

      // advance time by one minute and mine a new block to end IDO
      await time.increase(60);

      // Claim tokens and check balance of addr1
      await IDOPoolContract.connect(addr1).claim();
      expect(IDOUserInfo.total).to.equal(await rewardTokenContract.balanceOf(addr1.address));

      // Lock LP tokens and witdraw rest ETH with withdrawETH methods
      console.log('owner address', owner.address);
      console.log('addr1 address', addr1.address);
      console.log('hardhatLockerFactory address', addr1.address);
      console.log('rewardTokenContract address', rewardTokenContract.address);
      const tx = await IDOPoolContract.withdrawETH();
      const withdrawETHtx = await tx.wait();
      console.log('withdrawETHtx', withdrawETHtx);

    });
  })
});