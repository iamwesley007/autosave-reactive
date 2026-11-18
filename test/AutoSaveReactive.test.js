import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

const SYSTEM = "0x8888888888888888888888888888888888888888";
const SEPOLIA = 11155111n;
const WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const TRANSFER_TOPIC_0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3efn;
const REACTIVE_IGNORE = 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313adn;

async function expectRevert(txPromise, errorName) {
  try {
    const res = await txPromise;
    if (res && typeof res.wait === "function") await res.wait();
  } catch (e) {
    assert.match(e.message, new RegExp(errorName), `expected revert ${errorName}, got: ${String(e.message).slice(0, 300)}`);
    return;
  }
  assert.fail(`expected revert ${errorName}, but the call succeeded`);
}

function makeLog(ethers, { topic0, topic2, opCode, amount }) {
  return {
    chainId: SEPOLIA,
    contractAddress: WETH,
    topic0,
    topic1: 0n,
    topic2,
    topic3: 0n,
    data: ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [amount]),
    blockNumber: 1n,
    opCode,
    blockHash: 0n,
    txHash: 0n,
    logIndex: 0n,
  };
}

describe("AutoSaveReactive", () => {
  let ethers, connection;
  let owner, user, stranger, vaultAddr;
  let reactive, mockSystem;

  beforeEach(async () => {
    connection = await network.create();
    ({ ethers } = connection);
    [owner, user, stranger] = await ethers.getSigners();
    vaultAddr = stranger.address; // stand-in vault address for callback checks

    // Place the mock system contract's code at the real SYSTEM address.
    mockSystem = await ethers.deployContract("MockSystem");
    const mockCode = await ethers.provider.getCode(await mockSystem.getAddress());
    await connection.provider.send("hardhat_setCode", [SYSTEM, mockCode]);
    // Fund the SYSTEM account so impersonated react() calls can pay gas.
    await connection.provider.send("hardhat_setBalance", [SYSTEM, "0x56BC75E2D63100000"]); // 100 ETH
    await connection.provider.send("hardhat_impersonateAccount", [SYSTEM]);

    reactive = await ethers.deployContract(
      "AutoSaveReactive",
      [user.address, 1000n, ethers.parseEther("0.001"), vaultAddr],
      { value: ethers.parseEther("1") }
    );
  });

  function systemSigner() {
    return ethers.getImpersonatedSigner(SYSTEM);
  }

  async function callbackRequests(receipt) {
    const out = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== SYSTEM.toLowerCase()) continue;
      try {
        const parsed = mockSystem.interface.parseLog(log);
        if (parsed && parsed.name === "CallbackRequested") out.push(parsed.args);
      } catch { /* not a mock event */ }
    }
    return out;
  }

  async function subscriptionEvents(receipt, name) {
    const out = [];
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== SYSTEM.toLowerCase()) continue;
      try {
        const parsed = mockSystem.interface.parseLog(log);
        if (parsed && parsed.name === name) out.push(parsed.args);
      } catch { /* ignore */ }
    }
    return out;
  }

  it("subscribes in the constructor with the exact criteria", async () => {
    const fresh = await ethers.deployContract(
      "AutoSaveReactive",
      [user.address, 1000n, ethers.parseEther("0.001"), vaultAddr]
    );
    const receipt = await fresh.deploymentTransaction().wait();
    const subs = await subscriptionEvents(receipt, "Subscribed");
    assert.equal(subs.length, 1);
    const [subscriber, chainId, contractAddr, t0, t1, t2, t3] = subs[0];
    assert.equal(subscriber.toLowerCase(), (await fresh.getAddress()).toLowerCase());
    assert.equal(chainId, SEPOLIA);
    assert.equal(contractAddr.toLowerCase(), WETH.toLowerCase());
    assert.equal(t0, TRANSFER_TOPIC_0);
    assert.equal(t1, REACTIVE_IGNORE);
    assert.equal(t2, BigInt(user.address));
    assert.equal(t3, REACTIVE_IGNORE);
  });

  it("rejects a zero user and a rate above 10000 at construction", async () => {
    await expectRevert(
      ethers.deployContract("AutoSaveReactive", [ethers.ZeroAddress, 1000n, 0n, vaultAddr]),
      "InvalidUser"
    );
    await expectRevert(
      ethers.deployContract("AutoSaveReactive", [user.address, 10001n, 0n, vaultAddr]),
      "InvalidRate"
    );
  });

  it("rejects react() calls from anyone but SYSTEM", async () => {
    const log = makeLog(ethers, { topic0: TRANSFER_TOPIC_0, topic2: BigInt(user.address), opCode: 3n, amount: ethers.parseEther("1") });
    await expectRevert(reactive.connect(stranger).react(log), "NotAuthorized");
  });

  it("ignores logs with the wrong topic0, wrong recipient, or wrong topic count", async () => {
    const sys = await systemSigner();
    const base = { topic0: TRANSFER_TOPIC_0, topic2: BigInt(user.address), opCode: 3n, amount: ethers.parseEther("1") };
    await (await reactive.connect(sys).react(makeLog(ethers, { ...base, topic0: 1n }))).wait();
    await (await reactive.connect(sys).react(makeLog(ethers, { ...base, topic2: BigInt(stranger.address) }))).wait();
    await (await reactive.connect(sys).react(makeLog(ethers, { ...base, opCode: 1n }))).wait();
    assert.equal(await reactive.paymentsSeen(), 0n);
    assert.equal(await reactive.totalReceived(), 0n);
  });

  it("counts a qualifying payment and requests a callback with the right payload", async () => {
    const sys = await systemSigner();
    const amount = ethers.parseEther("2");
    const log = makeLog(ethers, { topic0: TRANSFER_TOPIC_0, topic2: BigInt(user.address), opCode: 3n, amount });
    const receipt = await (await reactive.connect(sys).react(log)).wait();

    assert.equal(await reactive.paymentsSeen(), 1n);
    assert.equal(await reactive.totalReceived(), amount);
    assert.equal(await reactive.totalSaved(), ethers.parseEther("0.2")); // 10%
    assert.notEqual(await reactive.lastSaveAt(), 0n);

    const cbs = await callbackRequests(receipt);
    assert.equal(cbs.length, 1);
    const [sender, chainId, recipient, gasLimit, payload] = cbs[0];
    assert.equal(sender.toLowerCase(), (await reactive.getAddress()).toLowerCase());
    assert.equal(chainId, SEPOLIA);
    assert.equal(recipient.toLowerCase(), vaultAddr.toLowerCase());
    assert.equal(gasLimit, 1_000_000n);

    const iface = new ethers.Interface(["function save(address,address,uint256)"]);
    const decoded = iface.decodeFunctionData("save", payload);
    assert.equal(decoded[0], ethers.ZeroAddress); // reserved slot for injection
    assert.equal(decoded[1].toLowerCase(), user.address.toLowerCase());
    assert.equal(decoded[2], ethers.parseEther("0.2"));
  });

  it("counts sub-minimum payments but requests no callback", async () => {
    const sys = await systemSigner();
    const amount = ethers.parseEther("0.0005"); // below 0.001 min
    const receipt = await (await reactive.connect(sys).react(
      makeLog(ethers, { topic0: TRANSFER_TOPIC_0, topic2: BigInt(user.address), opCode: 3n, amount })
    )).wait();
    assert.equal(await reactive.paymentsSeen(), 1n);
    assert.equal(await reactive.totalReceived(), amount);
    assert.equal(await reactive.totalSaved(), 0n);
    assert.equal((await callbackRequests(receipt)).length, 0);
  });

  it("requests no callback when the rate is 0 or the vault is unset", async () => {
    const sys = await systemSigner();
    const log = makeLog(ethers, { topic0: TRANSFER_TOPIC_0, topic2: BigInt(user.address), opCode: 3n, amount: ethers.parseEther("1") });

    await (await reactive.setSavingsRate(0n)).wait();
    let receipt = await (await reactive.connect(sys).react(log)).wait();
    assert.equal((await callbackRequests(receipt)).length, 0);

    await (await reactive.setSavingsRate(1000n)).wait();
    await (await reactive.setVault(ethers.ZeroAddress)).wait();
    receipt = await (await reactive.connect(sys).react(log)).wait();
    assert.equal((await callbackRequests(receipt)).length, 0);
  });

  it("pause unsubscribes and suppresses callbacks; resume resubscribes", async () => {
    const sys = await systemSigner();
    const log = makeLog(ethers, { topic0: TRANSFER_TOPIC_0, topic2: BigInt(user.address), opCode: 3n, amount: ethers.parseEther("1") });

    const pauseReceipt = await (await reactive.pause()).wait();
    assert.equal((await subscriptionEvents(pauseReceipt, "Unsubscribed")).length, 1);
    assert.equal(await reactive.paused(), true);

    const pausedReceipt = await (await reactive.connect(sys).react(log)).wait();
    assert.equal((await callbackRequests(pausedReceipt)).length, 0);
    assert.equal(await reactive.paymentsSeen(), 1n); // still counted, just not acted on

    const resumeReceipt = await (await reactive.resume()).wait();
    assert.equal((await subscriptionEvents(resumeReceipt, "Subscribed")).length, 1);
    assert.equal(await reactive.paused(), false);

    const liveReceipt = await (await reactive.connect(sys).react(log)).wait();
    assert.equal((await callbackRequests(liveReceipt)).length, 1);
  });

  it("only the owner can change settings, pause, resume, or withdraw", async () => {
    await expectRevert(reactive.connect(stranger).setSavingsRate(500n), "Unauthorized");
    await expectRevert(reactive.connect(stranger).setMinPayment(1n), "Unauthorized");
    await expectRevert(reactive.connect(stranger).setVault(stranger.address), "Unauthorized");
    await expectRevert(reactive.connect(stranger).pause(), "Unauthorized");
    await expectRevert(reactive.connect(stranger).withdraw(stranger.address, 1n), "Unauthorized");
    await expectRevert(reactive.connect(stranger).setSavingsRate(10001n), "Unauthorized"); // auth checked first
    await expectRevert(reactive.setSavingsRate(10001n), "InvalidRate");
  });

  it("coverDebt is callable by anyone and withdraw rescues funds to the owner", async () => {
    await (await reactive.connect(stranger).coverDebt()).wait(); // mock debt is 0; must not revert
    const before = await ethers.provider.getBalance(stranger.address);
    await (await reactive.withdraw(stranger.address, ethers.parseEther("0.5"))).wait();
    const after = await ethers.provider.getBalance(stranger.address);
    assert.equal(after - before, ethers.parseEther("0.5"));
  });
});
