# PROOF.md — on-chain proof of the full loop

## Status (18 Nov 2026)

**Full loop PROVEN end to end on public testnets.** A real 0.01 WETH payment
on Sepolia triggered the reactive contract on Lasna, which requested a
callback that saved 0.001 WETH (10%) into the vault on Sepolia. Every hash
below is a real explorer-verified transaction, recorded by
`scripts/03-demo-loop.js` in `proof.json` (run 18 Nov 2026, 15:21 UTC).

## Funding

The deployer/saver address (fresh throwaway testnet-only key, generated for
this project) is `0x3dd829cCeD56b1E9276780D1E3661d716a57a35F` (same address on
Sepolia and Lasna). It was funded with 0.1 Sepolia ETH, then 0.03 ETH was
swapped for lREACT via the official Reactive faucet contract:

- Faucet swap tx (Sepolia): `0x7cd8bba2818fe5e65e5455d3626426dcf8a8996819741130387801e8c5c87eea`
  — https://sepolia.etherscan.io/tx/0x7cd8bba2818fe5e65e5455d3626426dcf8a8996819741130387801e8c5c87eea
  — received 3.15 lREACT on Lasna.

## Deployed contracts

| Contract | Chain | Address | Explorer |
| --- | --- | --- | --- |
| AutoSaveReactive | Lasna (5318007) | `0x9D11B84491c551D69285DfbDB94f2605F49509cf` | https://lasna.reactscan.net/address/0x9D11B84491c551D69285DfbDB94f2605F49509cf |
| AutoSaveVault | Sepolia (11155111) | `0xcaF8ffD9473E1B8dF3f25901a9C727d4b8a2f316` | https://sepolia.etherscan.io/address/0xcaF8ffD9473E1B8dF3f25901a9C727d4b8a2f316 |

Wiring verified on-chain after deploy: vault set on the reactive contract,
savings rate 1000 bps (10%), min payment 0.001 WETH, reactive reserves 1.0
lREACT, vault reserves 0.01 Sepolia ETH, debt 0 on both sides.

## Full-loop transactions

| Step | Chain | Hash | Explorer |
| --- | --- | --- | --- |
| WETH approval (vault allowance) | Sepolia | `0xcfe4acd96f6f97dae73db5fc8b6e281d1c75fe74aadf24b54afb4af55ac61cb4` | https://sepolia.etherscan.io/tx/0xcfe4acd96f6f97dae73db5fc8b6e281d1c75fe74aadf24b54afb4af55ac61cb4 |
| WETH deposit (0.015 ETH → WETH) | Sepolia | `0x8b95e48bf3fcce06bad7423b05d65cc2979ff42a2a0f26e893fc6ce2e34ad810` | https://sepolia.etherscan.io/tx/0x8b95e48bf3fcce06bad7423b05d65cc2979ff42a2a0f26e893fc6ce2e34ad810 |
| Origin: WETH Transfer to saver (0.01) | Sepolia | `0x1795b6f79a6297f10293fb66682108a4b037edd8749f3d4dd7d87b3fd91a87fb` | https://sepolia.etherscan.io/tx/0x1795b6f79a6297f10293fb66682108a4b037edd8749f3d4dd7d87b3fd91a87fb |
| Reactive tx (`PaymentSeen`: amount 0.01, save 0.001) | Lasna | `0xc4eeef3eaa9d770a6b4aadbe8b001739638a3e5961812459cb5aa4a35c19a657` | https://lasna.reactscan.net/tx/0xc4eeef3eaa9d770a6b4aadbe8b001739638a3e5961812459cb5aa4a35c19a657 |
| Callback tx (`Saved`: 0.001, total 0.001) | Sepolia | `0x2b4099d690c4e1b2f8e0584069e545e1dfe5fc7eda3ddb79e0e4421c85f4fb80` | https://sepolia.etherscan.io/tx/0x2b4099d690c4e1b2f8e0584069e545e1dfe5fc7eda3ddb79e0e4421c85f4fb80 |

Resulting state: `paymentsSeen = 1`, `totalReceived = 0.01 WETH`,
`totalSaved = 0.001 WETH`, vault savings for the user `= 0.001 WETH`.

## Notes for reproducers

- Lasna rejects EIP-1559 transactions with a zero priority fee
  ("gas tip cap 0, minimum needed 1") because its fee oracle reports a 0
  tip. `scripts/lib.js` pins explicit fees for Lasna (maxFee 200 gwei,
  tip 2 gwei); without this, deployment transactions are rejected at the
  RPC layer before they ever land.
- The origin trigger is the canonical WETH9 `Transfer` event on Sepolia
  (`0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`), verified active with
  379 `Transfer` logs in a 500-block window (18 Nov 2026).
- Local tests (17/17) prove the logic against a mock system contract:
  exact subscription criteria, `react()` filtering, callback payload shape,
  pause/resume subscribe cycles, vault authentication, allowance/balance
  clamping, and withdrawals.
- Demo honesty: the "payment" is the author's own testnet WETH transfer and
  the vault is funded/approved by the same testnet wallet. The mechanism is
  identical for any user who configures their own address, rate, and
  allowance.
