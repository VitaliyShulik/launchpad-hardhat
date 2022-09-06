const { expect } = require("chai");

const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

const feeToken = "0x7ed59478Dd0c9C8417b64FC4f10e4F9cCA9C41e4"; // Openzeppelin ERC20Burnable token address.
const feeAmount = "0"; // Claim fee amount number of feeTokens when create IDO.
const burnPercent = "0"; // Burn some percent of feeTokens when create IDO. Divider is 100.

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
    const ether = BigNumber.from(10).pow(18);

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
    it("Create IDO pool and check default values", async function () {
      const { IDOPoolContract } = await loadFixture(deployIDOPoolFixture);

      console.log('IDOPool address', IDOPoolContract.address)

    });
  })
});