import * as fs from "fs";
import * as path from "path";
import { task, types } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

/**
 * Zama's canonical confidential test asset on Sepolia.
 *
 * From the Zama Protocol docs (*Protocol Apps → Contract addresses → Testnet → Sepolia*),
 * and verified against the live chain: `cUSDCMock` reports six decimals with `rate() == 1`,
 * and its underlying ERC-20 accepts a public `mint(address,uint256)` up to one million per
 * call.
 *
 * `packages/config/src/assets.ts` holds the application-side copy of these addresses,
 * including the other assets Zama publishes. The two are kept deliberately small and both
 * cite the same source; the deploy script cannot import the config package because Hardhat's
 * ts-node does not transpile TypeScript from another workspace package.
 */
const ZAMA_SEPOLIA_ASSET = {
  confidential: "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639",
  underlying: "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF",
  symbol: "cUSDCMock",
  decimals: 6,
} as const;

/** Mirrors `SableMath.MAX_CONFIDENTIAL_BALANCE`. */
const MAX_CONFIDENTIAL_BALANCE = 1_000_000_000_000n;

export interface SableDeployment {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  contracts: {
    Sable: DeployedContract;
    /** Present only when Sable deployed its own asset (local development). */
    SableConfidentialUSD?: DeployedContract;
    /** The yield adapter actually wired to the vault. */
    YieldAdapter: DeployedContract;
  };
  asset: {
    /** The ERC-7984 the vault custodies. */
    address: string;
    /** The ERC-20 beneath it, when the asset is a wrapper. */
    underlying: string | null;
    symbol: string;
    decimals: number;
    /** Decimals of the underlying ERC-20. */
    underlyingDecimals: number;
    /** Underlying units per confidential unit, from `rate()`. */
    rate: string;
    /** True when Sable deployed the asset itself rather than using an ecosystem one. */
    selfIssued: boolean;
  };
  parameters: {
    participantCap: number;
    ratePerYearBps: number;
    adapterKind: "reserve" | "mint";
    coveredDeposits: string | null;
  };
}

export interface DeployedContract {
  address: string;
  txHash: string;
  blockNumber: number;
}

export function deploymentPath(hre: HardhatRuntimeEnvironment, network?: string): string {
  return path.resolve(hre.config.paths.root, "../../deployments", `${network ?? hre.network.name}.json`);
}

export function readDeployment(hre: HardhatRuntimeEnvironment, network?: string): SableDeployment | null {
  const file = deploymentPath(hre, network);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as SableDeployment;
}

task("deploy:sable", "Deploys the Sable stack and records the addresses")
  .addOptionalParam("cap", "Participant cap", 50, types.int)
  .addOptionalParam("rate", "Published annual yield rate in basis points", 500, types.int)
  .addOptionalParam(
    "asset",
    "Confidential asset: 'zama' for the published cUSDCMock, 'own' to deploy one, or an address",
    undefined,
    types.string,
  )
  .setAction(async (args: { cap: number; rate: number; asset?: string }, hre) => {
    const { ethers } = hre;
    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    const chainId = Number(network.chainId);

    // Sepolia defaults to Zama's published asset; local chains have no such contract, so
    // they default to deploying one.
    const isLive = chainId === 11155111;
    const assetChoice = args.asset ?? (isLive ? "zama" : "own");
    const useZamaAsset = assetChoice === "zama" || assetChoice.startsWith("0x");

    console.log(`\nDeploying Sable to ${hre.network.name} (chainId ${chainId})`);
    console.log(`Deployer: ${deployer.address}`);
    const balance = await ethers.provider.getBalance(deployer.address);
    console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

    if (balance === 0n) throw new Error("Deployer has no ETH. Fund the account before deploying.");

    if (useZamaAsset && !isLive) {
      throw new Error(
        `Zama's confidential assets exist only on Sepolia. Use --asset own on ${hre.network.name}.`,
      );
    }

    let assetAddress: string;
    let underlying: string | null = null;
    let symbol: string;
    let decimals: number;
    let underlyingDecimals = 6;
    let rate = 1n;
    let ownToken: DeployedContract | undefined;

    if (useZamaAsset) {
      // ---------------------------------------------------------------- Zama asset
      assetAddress = assetChoice.startsWith("0x") ? assetChoice : ZAMA_SEPOLIA_ASSET.confidential;

      const wrapper = await ethers.getContractAt("IConfidentialWrapper", assetAddress);
      const erc7984 = await ethers.getContractAt("IERC7984", assetAddress);

      // Never take the documented values on trust — read them from the chain.
      underlying = await wrapper.underlying();
      symbol = await erc7984.symbol();
      decimals = Number(await erc7984.decimals());
      rate = await wrapper.rate();

      // The wrapper always reports 6 decimals; the token beneath it may be 18. Both are
      // needed, because faucet and reserve funding operate on the underlying.
      const underlyingToken = await ethers.getContractAt("IERC20Mintable", underlying);
      underlyingDecimals = Number(await underlyingToken.decimals());

      console.log(`Using Zama's published confidential asset:`);
      console.log(`  ${symbol} at ${assetAddress}`);
      console.log(`  underlying ${underlying}`);
      console.log(
        `  decimals ${decimals}, underlying decimals ${underlyingDecimals}, rate ${rate}\n`,
      );

      if (decimals !== 6) {
        throw new Error(`Asset reports ${decimals} decimals; Sable's accounting assumes 6.`);
      }
    } else {
      // ------------------------------------------------------------- Sable's own asset
      console.log("1/3  SableConfidentialUSD (local development asset) ...");
      const token = await (await ethers.getContractFactory("SableConfidentialUSD")).deploy(
        deployer.address,
      );
      await token.waitForDeployment();
      const receipt = await token.deploymentTransaction()!.wait();

      assetAddress = await token.getAddress();
      symbol = "cUSDS";
      decimals = 6;
      ownToken = {
        address: assetAddress,
        txHash: receipt!.hash,
        blockNumber: receipt!.blockNumber,
      };
      console.log(`     ${assetAddress}`);
    }

    // ------------------------------------------------------------------- Adapter
    //
    // The adapter is the only part of Sable that depends on who issues the asset. With an
    // ecosystem token Sable cannot mint, so yield comes from a pre-funded reserve; with its
    // own token it can issue directly. The vault is identical either way.
    const adapterKind: "reserve" | "mint" = useZamaAsset ? "reserve" : "mint";
    const coveredDeposits = MAX_CONFIDENTIAL_BALANCE * BigInt(args.cap);

    console.log(`2/3  Yield adapter (${adapterKind}-backed) ...`);

    let adapter;
    if (adapterKind === "reserve") {
      adapter = await (await ethers.getContractFactory("SableReserveYieldAdapter")).deploy(
        assetAddress,
        deployer.address,
        args.rate,
        coveredDeposits,
      );
    } else {
      adapter = await (await ethers.getContractFactory("SableTestnetYieldAdapter")).deploy(
        assetAddress,
        deployer.address,
        args.rate,
      );
    }
    await adapter.waitForDeployment();
    const adapterReceipt = await adapter.deploymentTransaction()!.wait();
    console.log(`     ${await adapter.getAddress()}`);

    // --------------------------------------------------------------------- Vault
    console.log("3/3  Sable ...");
    const sable = await (await ethers.getContractFactory("Sable")).deploy(
      assetAddress,
      await adapter.getAddress(),
      deployer.address,
      args.cap,
    );
    await sable.waitForDeployment();
    const sableReceipt = await sable.deploymentTransaction()!.wait();
    console.log(`     ${await sable.getAddress()}\n`);

    // -------------------------------------------------------------------- Wiring
    console.log("Wiring ...");
    await (await (adapter as unknown as { setVault: (a: string) => Promise<{ wait: () => Promise<unknown> }> })
      .setVault(await sable.getAddress())).wait();
    console.log("  adapter.setVault(sable)");

    if (adapterKind === "mint") {
      const token = await ethers.getContractAt("SableConfidentialUSD", assetAddress);
      await (await token.setMinter(await adapter.getAddress(), true)).wait();
      await (await token.setMinter(deployer.address, true)).wait();
      console.log("  token.setMinter(adapter)");
    }

    const deployment: SableDeployment = {
      network: hre.network.name,
      chainId,
      deployedAt: new Date().toISOString(),
      deployer: deployer.address,
      contracts: {
        Sable: {
          address: await sable.getAddress(),
          txHash: sableReceipt!.hash,
          blockNumber: sableReceipt!.blockNumber,
        },
        ...(ownToken ? { SableConfidentialUSD: ownToken } : {}),
        YieldAdapter: {
          address: await adapter.getAddress(),
          txHash: adapterReceipt!.hash,
          blockNumber: adapterReceipt!.blockNumber,
        },
      },
      asset: {
        address: assetAddress,
        underlying,
        symbol,
        decimals,
        underlyingDecimals,
        rate: rate.toString(),
        selfIssued: !useZamaAsset,
      },
      parameters: {
        participantCap: args.cap,
        ratePerYearBps: args.rate,
        adapterKind,
        coveredDeposits: adapterKind === "reserve" ? coveredDeposits.toString() : null,
      },
    };

    const file = deploymentPath(hre);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(deployment, null, 2)}\n`);

    console.log(`\nDeployment written to ${path.relative(process.cwd(), file)}`);

    if (adapterKind === "reserve") {
      console.log(
        `\n⚠  The reserve is empty, so no yield can accrue yet.\n` +
          `   Fund it before opening a round:\n` +
          `     npx hardhat reserve:fund --amount 50000 --network ${hre.network.name}`,
      );
    }

    console.log("\nEnvironment for apps/web/.env.local:");
    console.log(`NEXT_PUBLIC_CHAIN_ID=${chainId}`);
    console.log(`NEXT_PUBLIC_SABLE_ADDRESS=${deployment.contracts.Sable.address}`);
    console.log(`NEXT_PUBLIC_CONFIDENTIAL_ASSET_ADDRESS=${assetAddress}`);
    console.log(`NEXT_PUBLIC_YIELD_ADAPTER_ADDRESS=${deployment.contracts.YieldAdapter.address}`);
    console.log("\nNext: pnpm sync:abis");

    return deployment;
  });

task("verify:sable", "Verifies the deployed contracts on the block explorer").setAction(
  async (_args, hre) => {
    const deployment = readDeployment(hre);
    if (!deployment) {
      throw new Error(`No deployment found for "${hre.network.name}". Run deploy:sable first.`);
    }

    const { contracts, parameters, asset, deployer } = deployment;

    const targets: { name: string; address: string; args: unknown[] }[] = [];

    if (contracts.SableConfidentialUSD) {
      targets.push({
        name: "SableConfidentialUSD",
        address: contracts.SableConfidentialUSD.address,
        args: [deployer],
      });
    }

    targets.push({
      name: parameters.adapterKind === "reserve" ? "SableReserveYieldAdapter" : "SableTestnetYieldAdapter",
      address: contracts.YieldAdapter.address,
      args:
        parameters.adapterKind === "reserve"
          ? [asset.address, deployer, parameters.ratePerYearBps, parameters.coveredDeposits]
          : [asset.address, deployer, parameters.ratePerYearBps],
    });

    targets.push({
      name: "Sable",
      address: contracts.Sable.address,
      args: [asset.address, contracts.YieldAdapter.address, deployer, parameters.participantCap],
    });

    for (const target of targets) {
      console.log(`Verifying ${target.name} at ${target.address} ...`);
      try {
        await hre.run("verify:verify", { address: target.address, constructorArguments: target.args });
        console.log("  verified");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(message.toLowerCase().includes("already verified") ? "  already verified" : `  failed: ${message}`);
      }
    }
  },
);
