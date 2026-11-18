// Step 3 — Execute the full loop for real and record the proof.
//   1. Approve the vault + wrap ETH into WETH (Sepolia).
//   2. Transfer WETH to the saver (the origin event — real WETH Transfer).
//   3. Wait for the reactive transaction on Lasna (paymentsSeen increments).
//   4. Wait for the callback on Sepolia (vault savings increments).
//   5. Write proof.json with every transaction hash + explorer link.
// Usage: node scripts/03-demo-loop.js [paymentWeth]   (default 0.01)
import { ethers } from "ethers";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, sepoliaWallet, lasnaWallet, artifact, loadDeployments,
  WETH_SEPOLIA, WETH_ABI, LASNA_SYSTEM,
  SEPOLIA_EXPLORER, LASNA_EXPLORER, eth, sleep,
} from "./lib.js";

const PAYMENT = ethers.parseEther(process.argv[2] || "0.01");
const POLL_MS = 15000;
const TIMEOUT_MS = 12 * 60 * 1000;

const deployments = loadDeployments();
if (!deployments.reactive || !deployments.vault) {
  console.error("No deployments found. Run scripts/02-deploy.js first.");
  process.exit(1);
}

const sepolia = await sepoliaWallet();
const lasna = await lasnaWallet();
const user = sepolia.address;
const reactive = new ethers.Contract(deployments.reactive, artifact("AutoSaveReactive").abi, lasna);
const vault = new ethers.Contract(deployments.vault, artifact("AutoSaveVault").abi, sepolia);
const weth = new ethers.Contract(WETH_SEPOLIA, WETH_ABI, sepolia);

const startLasnaBlock = await lasna.provider.getBlockNumber();
const startSepoliaBlock = await sepolia.provider.getBlockNumber();
const seenBefore = await reactive.paymentsSeen();
const savedBefore = await vault.savings(user);
console.log(`starting state: paymentsSeen=${seenBefore}, savings=${eth(savedBefore)} WETH`);

// 1. Allowance + wrap.
const approveTx = await weth.approve(deployments.vault, ethers.parseEther("1"));
await approveTx.wait();
console.log("approve tx:", approveTx.hash);
const depositTx = await weth.deposit({ value: PAYMENT + ethers.parseEther("0.005") });
await depositTx.wait();
console.log("WETH deposit tx:", depositTx.hash, `(${eth(PAYMENT + ethers.parseEther("0.005"))} ETH -> WETH)`);

// 2. The origin event: a real WETH transfer to the saver.
const originTx = await weth.transfer(user, PAYMENT);
await originTx.wait();
console.log("ORIGIN tx (WETH Transfer):", originTx.hash);
console.log("  ", `${SEPOLIA_EXPLORER}/tx/${originTx.hash}`);

// 3. Wait for the reactive transaction on Lasna.
console.log("waiting for the reactive transaction on Lasna...");
let reactiveTxHash = null;
let paymentSeenEvent = null;
{
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const seen = await reactive.paymentsSeen();
    if (seen > seenBefore) break;
    await sleep(POLL_MS);
  }
  const events = await reactive.queryFilter(reactive.filters.PaymentSeen(), startLasnaBlock, "latest");
  if (events.length === 0) {
    console.error("No PaymentSeen event on Lasna within the timeout. The reactive loop did not fire.");
    process.exit(1);
  }
  paymentSeenEvent = events[events.length - 1];
  reactiveTxHash = paymentSeenEvent.transactionHash;
  console.log("REACTIVE tx (Lasna):", reactiveTxHash);
  console.log("  ", `${LASNA_EXPLORER}/tx/${reactiveTxHash}`);
  console.log("  PaymentSeen: user=%s amount=%s save=%s", paymentSeenEvent.args.user, eth(paymentSeenEvent.args.amount), eth(paymentSeenEvent.args.saveAmount));
}

// 3b. Ask the system contract what callback it recorded for that reactive tx.
let destTxHashFromSystem = null;
try {
  const system = new ethers.Contract(
    LASNA_SYSTEM,
    ["function getCallbacks(uint256) view returns (tuple(uint256,address,uint256,uint256,uint256,bytes)[])"],
    lasna.provider
  );
  const records = await system.getCallbacks(BigInt(reactiveTxHash));
  if (records.length > 0) {
    destTxHashFromSystem = "0x" + records[0][4].toString(16).padStart(64, "0");
    console.log("system getCallbacks: destination tx:", destTxHashFromSystem, "| err:", records[0][5] === "0x" ? "(none)" : records[0][5]);
  } else {
    console.log("system getCallbacks: no record yet (validators write it after delivery).");
  }
} catch (e) {
  console.log("getCallbacks lookup failed (non-fatal):", String(e.message).slice(0, 120));
}

// 4. Wait for the callback on Sepolia.
console.log("waiting for the callback on Sepolia...");
let callbackTxHash = null;
{
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const saved = await vault.savings(user);
    if (saved > savedBefore) break;
    await sleep(POLL_MS);
  }
  const events = await vault.queryFilter(vault.filters.Saved(), startSepoliaBlock, "latest");
  if (events.length === 0) {
    console.error("No Saved event on Sepolia within the timeout. The callback did not land.");
    process.exit(1);
  }
  const savedEvent = events[events.length - 1];
  callbackTxHash = savedEvent.transactionHash;
  console.log("CALLBACK tx (Sepolia):", callbackTxHash);
  console.log("  ", `${SEPOLIA_EXPLORER}/tx/${callbackTxHash}`);
  console.log("  Saved: user=%s amount=%s total=%s", savedEvent.args.user, eth(savedEvent.args.amount), eth(savedEvent.args.totalForUser));
}

const proof = {
  ranAt: new Date().toISOString(),
  user,
  paymentWeth: eth(PAYMENT),
  contracts: { reactive: deployments.reactive, vault: deployments.vault, weth: WETH_SEPOLIA },
  transactions: {
    approve: { hash: approveTx.hash, explorer: `${SEPOLIA_EXPLORER}/tx/${approveTx.hash}` },
    wethDeposit: { hash: depositTx.hash, explorer: `${SEPOLIA_EXPLORER}/tx/${depositTx.hash}` },
    originTransfer: { hash: originTx.hash, explorer: `${SEPOLIA_EXPLORER}/tx/${originTx.hash}` },
    reactive: { hash: reactiveTxHash, explorer: `${LASNA_EXPLORER}/tx/${reactiveTxHash}` },
    callback: { hash: callbackTxHash, explorer: `${SEPOLIA_EXPLORER}/tx/${callbackTxHash}` },
    callbackFromSystemRecord: destTxHashFromSystem,
  },
  stats: {
    paymentsSeen: (await reactive.paymentsSeen()).toString(),
    totalReceivedWei: (await reactive.totalReceived()).toString(),
    totalSavedWei: (await reactive.totalSaved()).toString(),
    vaultSavingsWei: (await vault.savings(user)).toString(),
  },
};
writeFileSync(join(ROOT, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
console.log("saved proof.json — full loop proven end to end.");
