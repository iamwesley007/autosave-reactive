import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

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

describe("AutoSaveVault", () => {
  let ethers, connection;
  let deployer, user, stranger, fakeReactive;
  let weth, vault, proxy, proxyAddr;

  beforeEach(async () => {
    connection = await network.create();
    ({ ethers } = connection);
    [deployer, user, stranger, fakeReactive] = await ethers.getSigners();

    weth = await ethers.deployContract("MockWETH");
    // MockSystem doubles as the callback proxy: it implements debt() -> 0,
    // which coverDebt() needs. Its address is impersonated for save() calls.
    proxy = await ethers.deployContract("MockSystem");
    proxyAddr = await proxy.getAddress();
    await connection.provider.send("hardhat_setBalance", [proxyAddr, "0x56BC75E2D63100000"]);
    await connection.provider.send("hardhat_impersonateAccount", [proxyAddr]);

    vault = await ethers.deployContract("AutoSaveVault", [
      proxyAddr,
      fakeReactive.address,
      await weth.getAddress(),
    ]);

    await weth.mint(user.address, ethers.parseEther("10"));
    await weth.connect(user).approve(await vault.getAddress(), ethers.parseEther("10"));
  });

  function proxySigner() {
    return ethers.getImpersonatedSigner(proxyAddr);
  }

  it("rejects a zero WETH address at construction", async () => {
    await expectRevert(
      ethers.deployContract("AutoSaveVault", [await proxy.getAddress(), fakeReactive.address, ethers.ZeroAddress]),
      "InvalidWETH"
    );
  });

  it("rejects save() from anyone but the proxy", async () => {
    await expectRevert(
      vault.connect(stranger).save(fakeReactive.address, user.address, ethers.parseEther("1")),
      "NotAuthorized"
    );
  });

  it("rejects save() when the injected sender is not the authorized reactive contract", async () => {
    const px = await proxySigner();
    await expectRevert(
      vault.connect(px).save(stranger.address, user.address, ethers.parseEther("1")),
      "CallbackNotAuthorized"
    );
  });

  it("pulls the savings cut and credits the ledger", async () => {
    const px = await proxySigner();
    const amount = ethers.parseEther("0.2");
    const receipt = await (await vault.connect(px).save(fakeReactive.address, user.address, amount)).wait();

    assert.equal(await vault.savings(user.address), amount);
    assert.equal(await vault.totalSaved(), amount);
    assert.equal(await weth.balanceOf(await vault.getAddress()), amount);
    assert.equal(await weth.balanceOf(user.address), ethers.parseEther("9.8"));

    const saved = receipt.logs.map((l) => {
      try { return vault.interface.parseLog(l); } catch { return null; }
    }).find((p) => p && p.name === "Saved");
    assert.ok(saved, "Saved event emitted");
    assert.equal(saved.args[1], amount);
  });

  it("clamps the pull to the allowance, then to the balance, and skips at zero", async () => {
    const px = await proxySigner();
    // Allowance clamp: approve only 0.05, request 0.2.
    await weth.connect(user).approve(await vault.getAddress(), ethers.parseEther("0.05"));
    await (await vault.connect(px).save(fakeReactive.address, user.address, ethers.parseEther("0.2"))).wait();
    assert.equal(await vault.savings(user.address), ethers.parseEther("0.05"));

    // Balance clamp: drain the user down to 0.01, approve plenty, request 1.
    await weth.connect(user).transfer(stranger.address, ethers.parseEther("9.94")); // leaves 0.01
    await weth.connect(user).approve(await vault.getAddress(), ethers.parseEther("10"));
    await (await vault.connect(px).save(fakeReactive.address, user.address, ethers.parseEther("1"))).wait();
    assert.equal(await vault.savings(user.address), ethers.parseEther("0.06")); // 0.05 + 0.01

    // Zero pull: no balance left; must emit SaveSkipped, not revert.
    const receipt = await (await vault.connect(px).save(fakeReactive.address, user.address, ethers.parseEther("1"))).wait();
    assert.equal(await vault.savings(user.address), ethers.parseEther("0.06"));
    const skipped = receipt.logs.map((l) => {
      try { return vault.interface.parseLog(l); } catch { return null; }
    }).find((p) => p && p.name === "SaveSkipped");
    assert.ok(skipped, "SaveSkipped event emitted");
  });

  it("lets the saver withdraw their savings, and no more", async () => {
    const px = await proxySigner();
    await (await vault.connect(px).save(fakeReactive.address, user.address, ethers.parseEther("0.3"))).wait();

    await expectRevert(vault.connect(user).withdraw(ethers.parseEther("0.31")), "InsufficientSavings");
    await expectRevert(vault.connect(stranger).withdraw(ethers.parseEther("0.01")), "InsufficientSavings");

    await (await vault.connect(user).withdraw(ethers.parseEther("0.3"))).wait();
    assert.equal(await vault.savings(user.address), 0n);
    assert.equal(await vault.totalSaved(), 0n);
    assert.equal(await weth.balanceOf(user.address), ethers.parseEther("10"));
  });

  it("accepts ETH funding and coverDebt() settles without reverting", async () => {
    await deployer.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther("0.5") });
    assert.equal(await ethers.provider.getBalance(await vault.getAddress()), ethers.parseEther("0.5"));
    await (await vault.connect(stranger).coverDebt()).wait();
    // pay() is provider-only
    await expectRevert(vault.connect(stranger).pay(1n), "NotAuthorized");
  });
});
