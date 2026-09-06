import { ethers, fhevm } from "hardhat";
import { readFileSync } from "fs";
async function main() {
  const d = JSON.parse(readFileSync("../../deployments/sepolia.json", "utf8"));
  const addr = d.contracts.YieldAdapter.address;
  const a = await ethers.getContractAt("SableReserveYieldAdapter", addr);
  const asset = await ethers.getContractAt("IERC7984", d.asset.address);

  console.log("adapter", addr);
  console.log("rate   ", (await a.ratePerYearBps()).toString(), "bps/yr  (", Number(await a.ratePerYearBps())/100, "%)");
  console.log("last accrual", new Date(Number(await a.lastAccrualAt()) * 1000).toISOString());

  const handle = await asset.confidentialBalanceOf(addr);
  await fhevm.initializeCLIApi();
  const [signer] = await ethers.getSigners();
  const clear = await fhevm.userDecryptEuint(1, handle as string, d.asset.address, signer);
  console.log("reserve", (Number(clear) / 10 ** d.asset.decimals).toLocaleString(), d.asset.symbol);
}
main().catch((e)=>{console.error("ERR:", e.message.slice(0, 200)); process.exit(1);});
