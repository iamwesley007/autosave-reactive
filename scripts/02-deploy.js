// Step 2 — Deploy AutoSave to testnet (Lasna + Sepolia) and fund both sides.
// Order (per the Reactive docs): reactive first, then the callback contract
// with the reactive address, then set the vault on the reactive contract.
// Usage: node scripts/02-deploy.js
// Env overrides: SAVINGS_BPS (default 1000 = 10%), MIN_PAYMENT_ETH (default 0.001)
import { ethers } from "ethers";
import {
  sepoliaWallet, lasnaWallet, artifact, loadDeployments, saveDeployments,
  WETH_SEPOLIA, SEPOLIA_CALLBACK_PROXY, LASNA_SYSTEM, PAYABLE_ABI,
  SEPOLIA_EXPLORER, LASNA_EXPLORER, eth,
} from "./lib.js";

const SAVINGS_BPS = BigInt(process.env.SAVINGS_BPS || "1000");
const MIN_PAYMENT = ethers.parseEther(process.env.MIN_PAYMENT_ETH || "0.001");
// Funding sized for Lasna's ~100 gwei gas price (fee per reaction ~0.025 lREACT).
const REACTIVE_VALUE = ethers.parseEther("0.5"); // constructor balance
const REACTIVE_RESERVES = ethers.parseEther("1"); // depositTo reserves
const VAULT_VALUE = ethers.parseEther("0.005"); // constructor balance (Sepolia ETH)
const VAULT_RESERVES = ethers.parseEther("0.01"); // depositTo reserves on the proxy

const lasna = await lasnaWallet();
const sepolia = await sepoliaWallet();
const user = sepolia.address;
console.log("deployer/user:", user);

const lasnaBal = await lasna.provider.getBalance(user);
console.log("lREACT balance:", eth(lasnaBal));
if (lasnaBal < REACTIVE_VALUE + REACTIVE_RESERVES + ethers.parseEther("0.2")) {
  console.error("Not enough lREACT. Run scripts/01-fund-lasna.js first.");
  process.exit(1);
}
const sepBal = await sepolia.provider.getBalance(user);
console.log("Sepolia ETH balance:", eth(sepBal));
if (sepBal < VAULT_VALUE + VAULT_RESERVES + ethers.parseEther("0.005")) {
  console.error("Not enough Sepolia ETH for the vault + reserves.");
  process.exit(1);
}

// 1. Reactive contract on Lasna (vault unknown yet -> zero address).
const reactiveArtifact = artifact("AutoSaveReactive");
const ReactiveFactory = new ethers.ContractFactory(reactiveArtifact.abi, reactiveArtifact.bytecode, lasna);
const reactive = await ReactiveFactory.deploy(user, SAVINGS_BPS, MIN_PAYMENT, ethers.ZeroAddress, { value: REACTIVE_VALUE });
await reactive.waitForDeployment();
const reactiveAddr = await reactive.getAddress();
console.log("AutoSaveReactive:", reactiveAddr);
console.log("  ", `${LASNA_EXPLORER}/address/${reactiveAddr}`);

// 2. Vault on Sepolia, authorized for the reactive contract.
const vaultArtifact = artifact("AutoSaveVault");
const VaultFactory = new ethers.ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode, sepolia);
const vault = await VaultFactory.deploy(SEPOLIA_CALLBACK_PROXY, reactiveAddr, WETH_SEPOLIA, { value: VAULT_VALUE });
await vault.waitForDeployment();
const vaultAddr = await vault.getAddress();
console.log("AutoSaveVault:", vaultAddr);
console.log("  ", `${SEPOLIA_EXPLORER}/address/${vaultAddr}`);

// 3. Point the reactive contract at the vault.
const tx = await reactive.setVault(vaultAddr);
await tx.wait();
console.log("setVault tx:", tx.hash);

// 4. Fund reserves on both sides via depositTo (settles debt first, then reserves).
const system = new ethers.Contract(LASNA_SYSTEM, PAYABLE_ABI, lasna);
const tx1 = await system["depositTo(address)"](reactiveAddr, { value: REACTIVE_RESERVES });
await tx1.wait();
console.log("reactive reserves deposit:", tx1.hash, `(${eth(REACTIVE_RESERVES)} lREACT)`);

const proxy = new ethers.Contract(SEPOLIA_CALLBACK_PROXY, PAYABLE_ABI, sepolia);
const tx2 = await proxy["depositTo(address)"](vaultAddr, { value: VAULT_RESERVES });
await tx2.wait();
console.log("vault reserves deposit:", tx2.hash, `(${eth(VAULT_RESERVES)} Sepolia ETH)`);

// 5. Verify funding state.
console.log("reactive debt:", eth(await system["debt(address)"](reactiveAddr)),
  "| reserves:", eth(await system["reserves(address)"](reactiveAddr)));
console.log("vault debt:", eth(await proxy["debt(address)"](vaultAddr)),
  "| reserves:", eth(await proxy["reserves(address)"](vaultAddr)));
console.log("reactive savingsRateBps:", await reactive.savingsRateBps(),
  "| minPayment:", eth(await reactive.minPayment()),
  "| vault:", await reactive.vault());

const deployments = {
  ...loadDeployments(),
  network: "testnet",
  user,
  savingsRateBps: SAVINGS_BPS.toString(),
  minPaymentWei: MIN_PAYMENT.toString(),
  reactive: reactiveAddr,
  vault: vaultAddr,
  reactiveDeployTx: reactive.deploymentTransaction().hash,
  vaultDeployTx: vault.deploymentTransaction().hash,
  setVaultTx: tx.hash,
  reactiveReservesTx: tx1.hash,
  vaultReservesTx: tx2.hash,
  deployedAt: new Date().toISOString(),
};
saveDeployments(deployments);
console.log("saved deployments.json");
