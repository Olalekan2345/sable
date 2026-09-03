import { task, types } from "hardhat/config";

import { readDeployment } from "./deploy";

/**
 * Deposits into the vault from the command line.
 *
 * A convenience for exercising a round end to end without a browser — funding a demo,
 * verifying a fresh deployment, or giving a round a participant so the draw has something to
 * settle. The app is the real interface; this exists so the whole cycle can be checked from a
 * terminal.
 *
 * The amount is encrypted the same way the browser encrypts it: an `externalEuint64` plus its
 * input proof, built here through the FHEVM plugin against the live relayer. Nothing about the
 * amount is visible in the calldata, exactly as with a deposit made through the interface.
 */
task("demo:deposit", "Authorises the vault and deposits an encrypted amount")
  .addParam("amount", "Whole tokens to deposit", undefined, types.string)
  .addOptionalParam("mode", "Yield mode: 'lucky', 'steady', or omit to keep the default", undefined, types.string)
  .setAction(async (args: { amount: string; mode?: string }, hre) => {
    const deployment = readDeployment(hre);
    if (!deployment) throw new Error(`No deployment found for "${hre.network.name}".`);

    const { ethers, fhevm } = hre as typeof hre & { fhevm: typeof import("hardhat").fhevm };
    const [signer] = await ethers.getSigners();

    const sableAddress = deployment.contracts.Sable.address;
    const sable = await ethers.getContractAt("Sable", sableAddress);
    const asset = await ethers.getContractAt("IERC7984", deployment.asset.address);

    const amount = BigInt(args.amount) * 10n ** BigInt(deployment.asset.decimals);
    console.log(`\nDepositing ${args.amount} ${deployment.asset.symbol} as ${signer.address}`);

    // ERC-7984 uses time-bounded operators rather than allowances, so the vault has to be
    // authorised before it can move anything — the same first step the app walks through.
    const until = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    const operator = asset as unknown as {
      isOperator: (holder: string, spender: string) => Promise<boolean>;
      setOperator: (spender: string, until: number) => Promise<{ wait: () => Promise<unknown> }>;
    };

    if (!(await operator.isOperator(signer.address, sableAddress))) {
      console.log("  authorising the vault ...");
      await (await operator.setOperator(sableAddress, until)).wait();
    }

    // The plugin wires itself up automatically inside a test run, but a task has to ask. This
    // is what fetches the relayer's keys and makes encryption possible against a live network.
    await fhevm.initializeCLIApi();

    console.log("  encrypting locally ...");
    const encrypted = await fhevm
      .createEncryptedInput(sableAddress, signer.address)
      .add64(amount)
      .encrypt();

    console.log("  depositing ...");
    const tx = await sable.deposit(
      ethers.hexlify(encrypted.handles[0]),
      ethers.hexlify(encrypted.inputProof),
    );
    await tx.wait();
    console.log(`  deposited — ${tx.hash}`);

    if (args.mode) {
      const lucky = args.mode.toLowerCase() === "lucky";
      console.log(`\nSetting mode to ${lucky ? "Lucky" : "Steady"} ...`);
      const bit = await fhevm
        .createEncryptedInput(sableAddress, signer.address)
        .addBool(lucky)
        .encrypt();

      const modeTx = await sable.setMode(
        ethers.hexlify(bit.handles[0]),
        ethers.hexlify(bit.inputProof),
      );
      await modeTx.wait();
      console.log(`  mode set — ${modeTx.hash}`);
    } else {
      console.log("\nMode left at the default, which is Lucky — this deposit is in the draw.");
    }
  });
