import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";

import * as dotenv from "dotenv";
import * as path from "path";
import type { HardhatUserConfig } from "hardhat/config";

import "./tasks/deploy";
import "./tasks/lifecycle";
import "./tasks/abis";
import "./tasks/keeper";
import "./tasks/demo";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

/*
 * Default endpoint.
 *
 * Was `ethereum-sepolia-rpc.publicnode.com`, which drops sockets partway through a run of
 * transactions — a batch of round configurations failed at seven of twenty-eight, and a
 * deposit failed twice in a row before the same call succeeded elsewhere. Override with
 * `SEPOLIA_RPC_URL`; a dedicated endpoint is worth having for anything that writes.
 */
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "https://11155111.rpc.thirdweb.com";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

/**
 * Sable uses a deterministic mnemonic on the in-process Hardhat network so that
 * FHEVM mock coprocessor state is reproducible between runs.
 */
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        // FHE call sites are large; a moderate run count keeps bytecode under the
        // EIP-170 limit while still optimising the hot round-processing loops.
        runs: 200,
      },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "none" },
    },
  },
  networks: {
    hardhat: {
      accounts: { mnemonic: TEST_MNEMONIC, count: 20 },
      chainId: 31337,
      allowUnlimitedContractSize: false,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: { sepolia: ETHERSCAN_API_KEY },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
  typechain: {
    outDir: "types",
    target: "ethers-v6",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 300000,
  },
};

export default config;
