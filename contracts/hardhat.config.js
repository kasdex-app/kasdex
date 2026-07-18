require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
require('dotenv').config();

// Throwaway dev key only — NEVER put a key holding real funds here.
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_KEY ? [DEPLOYER_KEY] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // Igra Galleon testnet (gas: iKAS) — faucet: https://faucet.zealousswap.com (3,000 iKAS/24h)
    // (replaced the retired Caravel testnet; verified live 2026-07-15)
    galleon: {
      url: 'https://galleon-testnet.igralabs.com:8545',
      chainId: 38836,
      accounts,
      gasPrice: 2_000_000_000_000, // Galleon enforces a 2000 gwei minimum
    },
    // Igra mainnet (gas: iKAS) — DO NOT deploy unaudited contracts here
    igra: {
      url: 'https://rpc.igralabs.com:8545',
      chainId: 38833,
      accounts,
    },
    // Kasplex zkEVM testnet (gas: test KAS)
    kasplexTest: {
      url: 'https://rpc.kasplextest.xyz',
      chainId: 167012,
      accounts,
    },
  },
};
