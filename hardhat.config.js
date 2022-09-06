require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const INFURA_API_KEY = process.env.INFURA_API_KEY
const PRIVATE_KEY = process.env.PRIVATE_KEY

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
        {
            version: "0.8.12"
        },
    ]
  },
  networks: {
    goerli: {
      url: `https://goerli.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [PRIVATE_KEY]
    },
    hardhat: {
      forking: {
        url: `https://goerli.infura.io/v3/${INFURA_API_KEY}`,
        // blockNumber: 1000000,
      },
      allowUnlimitedContractSize: true,
    }
  },
};