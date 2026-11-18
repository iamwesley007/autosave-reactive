// Step 4 — Status: balances, reserves, debt, and stats on both chains.
// Usage: node scripts/04-status.js
import { ethers } from "ethers";
import {
  sepoliaWallet, lasnaWallet, artifact, loadDeployments,
  WETH_SEPOLIA, WETH_ABI, SEPOLIA_CALLBACK_PROXY, LASNA_SYSTEM, PAYABLE_ABI,
  eth,
} from "./lib.js";

const deployments = loadDeployments();
const sepolia = await sepoliaWallet();
const lasna = await lasnaWallet();
const user = sepolia.address;

console.log("user:", user);
console.log("Sepolia ETH:", eth(await sepolia.provider.getBalance(user)));
console.log("lREACT:", eth(await lasna.provider.getBalance(user)));
const weth = new ethers.Contract(WETH_SEPOLIA, WETH_ABI, sepolia.provider);
console.log("WETH (Sepolia):", eth(await weth.balanceOf(user)));

if (deployments.reactive) {
  const reactive = new ethers.Contract(deployments.reactive, artifact("AutoSaveReactive").abi, lasna.provider);
  const system = new ethers.Contract(LASNA_SYSTEM, PAYABLE_ABI, lasna.provider);
  console.log("\nAutoSaveReactive:", deployments.reactive);
  console.log("  balance:", eth(await lasna.provider.getBalance(deployments.reactive)),
    "| debt:", eth(await system["debt(address)"](deployments.reactive)),
    "| reserves:", eth(await system["reserves(address)"](deployments.reactive)));
  console.log("  paused:", await reactive.paused(),
    "| rateBps:", await reactive.savingsRateBps(),
    "| minPayment:", eth(await reactive.minPayment()),
    "| vault:", await reactive.vault());
  console.log("  paymentsSeen:", await reactive.paymentsSeen(),
    "| totalReceived:", eth(await reactive.totalReceived()),
    "| totalSaved:", eth(await reactive.totalSaved()));
}

if (deployments.vault) {
  const vault = new ethers.Contract(deployments.vault, artifact("AutoSaveVault").abi, sepolia.provider);
  const proxy = new ethers.Contract(SEPOLIA_CALLBACK_PROXY, PAYABLE_ABI, sepolia.provider);
  console.log("\nAutoSaveVault:", deployments.vault);
  console.log("  balance:", eth(await sepolia.provider.getBalance(deployments.vault)),
    "| debt:", eth(await proxy["debt(address)"](deployments.vault)),
    "| reserves:", eth(await proxy["reserves(address)"](deployments.vault)));
  console.log("  savings[user]:", eth(await vault.savings(user)),
    "| totalSaved:", eth(await vault.totalSaved()),
    "| vault WETH:", eth(await weth.balanceOf(deployments.vault)));
  console.log("  allowance[user -> vault]:", eth(await weth.allowance(user, deployments.vault)));
}
