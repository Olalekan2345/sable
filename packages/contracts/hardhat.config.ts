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
/*
 * `||`, not `??`.
 *
 * CI supplies this from an optional repository secret, and GitHub Actions sets an absent
 * secret to the empty string rather than leaving it unset — so `??` handed hardhat `""` and
 * every run died on `HH117: Empty string for network or forking URL`. An unset variable and
 * a variable set to nothing mean the same thing here, and both should fall back.
 */
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://11155111.rpc.thirdweb.com";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

/**
 * The keeper's key, optionally.
 *
 * Round advancement is permissionless, so the account that drives it needs gas and nothing
 * else — no role, no ownership, no access to the reserve. Keeping it separate from the
 * deployer is the entire point: the deployer holds ADMIN_ROLE and the reserve, and a key that
 * runs unattended on a schedule should be worthless if it leaks.
 *
 * Set it and the `keeper` task signs with it. Leave it unset and the task falls back to the
 * deployer, which still works — every call it makes is open to anyone — but is not what you
 * want running on a cron.
 *
 * It is listed second so the deployer stays `getSigners()[0]` and every admin task keeps
 * signing with the key it always did.
 */
const KEEPER_PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY ?? "";

const SEPOLIA_ACCOUNTS = [DEPLOYER_PRIVATE_KEY, KEEPER_PRIVATE_KEY].filter(
  // Hardhat rejects a duplicate account, and pointing both variables at one key is an easy
  // mistake to make when trying this out.
  (key, index, all) => key !== "" && all.indexOf(key) === index,
);

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
      accounts: SEPOLIA_ACCOUNTS,
    },
  },
  etherscan: {
    /*
     * A single key, not a per-network map.
     *
     * The `{ sepolia: ... }` form targets Etherscan's V1 API, which has been retired — it now
     * answers every request with "You are using a deprecated V1 endpoint". V2 is one unified
     * key across every chain, so the per-network shape has nothing left to express.
     */
    apiKey: ETHERSCAN_API_KEY,
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
