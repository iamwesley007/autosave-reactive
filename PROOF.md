# PROOF.md — on-chain proof of the full loop

## Status (18 Nov 2026)

**Contracts built and unit-tested (17/17 passing). Testnet deployment is
PENDING FUNDING — see below. No transactions have been sent yet, so no
hashes are claimed here.**

Nothing in this file is faked: the hashes below will be filled in only from
real explorer-verified transactions, by `scripts/03-demo-loop.js`
(`proof.json`) and manual explorer checks.

## Why deployment is pending

Testnet deployment needs Sepolia ETH (gas + the Lasna faucet swap) and
testnet lREACT. Every public Sepolia faucet checked on 18 Nov 2026 requires
one of: a real browser + captcha / wallet connection (pk910 PoW faucet,
QuickNode, Chainlink, GetBlock), an account (Alchemy, Infura, Google Cloud,
Optimism, Chainstack, Tatum), a mainnet balance (Alchemy), or identity
verification (ethfaucet.com / BringID). Several others are dead or suspended
(Triangle, BlastAPI, Mudit, Paradigm). This build environment has no working
browser path to those faucets, and no accounts were created.

The deployer address awaiting funding (fresh throwaway testnet-only key,
generated for this project):

- **Deployer / saver: `0x3dd829cCeD56b1E9276780D1E3661d716a57a35F`**
  (same address on Sepolia and Lasna)

Funding needed: **≥ 0.05 Sepolia ETH** (0.1+ preferred). Once funded, run:

```bash
node scripts/01-fund-lasna.js 0.05   # swap Sepolia ETH -> lREACT
node scripts/02-deploy.js            # deploy + wire + fund reserves
node scripts/03-demo-loop.js 0.01    # full loop, writes proof.json
```

## Deployed contracts (to be filled)

| Contract | Chain | Address | Explorer |
| --- | --- | --- | --- |
| AutoSaveReactive | Lasna (5318007) | _pending_ | _pending_ |
| AutoSaveVault | Sepolia (11155111) | _pending_ | _pending_ |

## Full-loop transactions (to be filled)

| Step | Chain | Hash | Explorer |
| --- | --- | --- | --- |
| WETH approval | Sepolia | _pending_ | _pending_ |
| WETH deposit | Sepolia | _pending_ | _pending_ |
| Origin: WETH Transfer to saver | Sepolia | _pending_ | _pending_ |
| Reactive tx (`PaymentSeen`) | Lasna | _pending_ | _pending_ |
| Callback tx (`Saved`) | Sepolia | _pending_ | _pending_ |

## What was verified without funding

- Lasna RPC live: chain ID 5318007, system contract
  `0x8888...8888` has code, gas price ~100 gwei.
- Sepolia callback proxy `0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4` has code.
- Canonical WETH9 `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` is active:
  379 `Transfer` logs in a 500-block window (18 Nov 2026).
- Reactive faucet contracts live and funded (Lasna faucet reactive contract
  holds a large lREACT balance; L1 contract accepts `request(address)`).
- Local tests prove the logic end to end against a mock system contract:
  exact subscription criteria, `react()` filtering, callback payload shape
  (reserved address slot, user, cut), pause/resume subscribe cycles, vault
  authentication, allowance/balance clamping, and withdrawals.
