// Shared helpers for the AutoSave testnet scripts.
// TESTNET ONLY. Every script asserts the expected chain IDs before sending
// anything: Sepolia 11155111, Reactive Lasna 5318007. Never mainnet.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
export const LASNA_RPC = "https://lasna-rpc.rnk.dev/";
export const SEPOLIA_CHAIN_ID = 11155111n;
export const LASNA_CHAIN_ID = 5318007n;

export const WETH_SEPOLIA = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
export const SEPOLIA_CALLBACK_PROXY = "0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4";
export const LASNA_SYSTEM = "0x8888888888888888888888888888888888888888";
export const LASNA_FAUCET_L1 = "0x9b9BB25f1A81078C544C829c5EB7822d747Cf434";

export const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";
export const LASNA_EXPLORER = "https://lasna.reactscan.net";

export const WETH_ABI = [
  "function deposit() payable",
  "function withdraw(uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

export const FAUCET_L1_ABI = ["function request(address receiver) payable"];

export const PAYABLE_ABI = [
  "function depositTo(address) payable",
  "function debt(address) view returns (uint256)",
  "function reserves(address) view returns (uint256)",
];

export function loadKey() {
  const path = join(ROOT, ".deployer-key");
  if (!existsSync(path)) throw new Error("missing .deployer-key — generate a fresh throwaway testnet key first");
  return readFileSync(path, "utf8").trim();
}

export async function sepoliaWallet() {
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== SEPOLIA_CHAIN_ID) throw new Error(`refusing to run: Sepolia RPC returned chain ${chainId}`);
  return new ethers.Wallet(loadKey(), provider);
}

export async function lasnaWallet() {
  const provider = new ethers.JsonRpcProvider(LASNA_RPC);
  const chainId = (await provider.getNetwork()).chainId;
  if (chainId !== LASNA_CHAIN_ID) throw new Error(`refusing to run: Lasna RPC returned chain ${chainId}`);
  // Lasna rejects EIP-1559 txs with a zero tip ("gas tip cap 0, minimum needed
  // 1") because its fee oracle reports a 0 priority fee. Pin explicit fees:
  // maxFee 200 gwei (charged amount is still base + tip), tip 2 gwei.
  const feeData = new ethers.FeeData(null, ethers.parseUnits("200", "gwei"), ethers.parseUnits("2", "gwei"));
  provider.getFeeData = async () => feeData;
  return new ethers.Wallet(loadKey(), provider);
}

export function artifact(name) {
  const path = join(ROOT, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function deploymentsPath() {
  return join(ROOT, "deployments.json");
}

export function loadDeployments() {
  const path = deploymentsPath();
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

export function saveDeployments(data) {
  writeFileSync(deploymentsPath(), JSON.stringify(data, null, 2) + "\n");
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function eth(n) {
  return ethers.formatEther(n);
}
