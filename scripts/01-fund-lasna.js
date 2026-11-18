// Step 1 — Fund Lasna: swap Sepolia ETH for testnet lREACT via the official
// Reactive faucet contract. 1 Sepolia ETH -> 100 lREACT (max 5 ETH per tx).
// Requires the deployer wallet to hold Sepolia ETH from a public faucet.
// Usage: node scripts/01-fund-lasna.js [ethAmount]   (default 0.05)
import { ethers } from "ethers";
import {
  sepoliaWallet, lasnaWallet, LASNA_FAUCET_L1, FAUCET_L1_ABI,
  SEPOLIA_EXPLORER, LASNA_EXPLORER, eth, sleep,
} from "./lib.js";

const SEND = ethers.parseEther(process.argv[2] || "0.05");

const sepolia = await sepoliaWallet();
const lasna = await lasnaWallet();
console.log("deployer:", sepolia.address);

const sepBal = await sepolia.provider.getBalance(sepolia.address);
console.log("Sepolia ETH balance:", eth(sepBal));
if (sepBal < SEND + ethers.parseEther("0.005")) {
  console.error(`NEED MORE SEPOLIA ETH: have ${eth(sepBal)}, want to swap ${eth(SEND)} plus gas.`);
  console.error("Fund this address from a public Sepolia faucet first, then re-run.");
  process.exit(1);
}
const lasnaBefore = await lasna.provider.getBalance(lasna.address);
console.log("lREACT balance before:", eth(lasnaBefore));

const faucet = new ethers.Contract(LASNA_FAUCET_L1, FAUCET_L1_ABI, sepolia);
const tx = await faucet.request(sepolia.address, { value: SEND });
console.log("faucet request tx:", tx.hash);
console.log("  ", `${SEPOLIA_EXPLORER}/tx/${tx.hash}`);
await tx.wait();
console.log("confirmed. Waiting for the lREACT payout on Lasna (reactive loop, may take minutes)...");

const deadline = Date.now() + 15 * 60 * 1000;
for (;;) {
  const bal = await lasna.provider.getBalance(lasna.address);
  if (bal > lasnaBefore) {
    console.log("lREACT balance now:", eth(bal), `(received ${eth(bal - lasnaBefore)})`);
    console.log("Lasna account:", `${LASNA_EXPLORER}/address/${lasna.address}`);
    break;
  }
  if (Date.now() > deadline) {
    console.error("Timed out waiting for the lREACT payout. Check the explorer; re-run if it never arrived.");
    process.exit(1);
  }
  await sleep(15000);
}
