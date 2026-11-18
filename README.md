# AutoSave — automatic savings on every WETH payment

**Reactive Omni Buildathon — "Set It and Forget It" track.**

Set a savings rate once. From then on, every time WETH lands in your wallet
on Ethereum Sepolia, a reactive contract on Reactive Lasna notices the
transfer and a callback on Sepolia pulls your savings cut into your personal
savings ledger. No bot, no keeper, no app to open. Withdraw any time.

## How it works

```
Sepolia (origin + destination)              Lasna (Reactive)
┌─────────────────────────────┐            ┌──────────────────────────┐
│ WETH9 (canonical)           │ Transfer   │ AutoSaveReactive         │
│  you receive a WETH payment │──event────▶│  - subscribed: Transfer, │
└─────────────────────────────┘            │    topic2 == your address│
                                           │  - min payment + save %  │
┌─────────────────────────────┐  callback  │  - requests callback     │
│ AutoSaveVault (callback)    │◀───────────│  - stats + pause/resume  │
│  - pulls save cut via       │            └──────────────────────────┘
│    transferFrom (allowance) │
│  - per-user savings ledger  │
│  - withdraw() any time      │
└─────────────────────────────┘
```

1. **You configure once:** deploy (or use) an `AutoSaveReactive` for your
   address with a savings rate (e.g. 10%) and a minimum payment, approve the
   `AutoSaveVault` to pull WETH, and fund both contracts' reserves.
2. **You get paid:** any `Transfer` of WETH to your address emits the
   canonical WETH event on Sepolia.
3. **Reactive notices:** the system contract delivers the log to
   `AutoSaveReactive.react()`, which checks the amount against your minimum,
   computes the cut, and requests a callback.
4. **Savings land:** the callback proxy calls `AutoSaveVault.save()`, which
   pulls `min(cut, allowance, balance)` WETH from your wallet into your
   savings ledger. It never reverts on low allowance — it clamps and skips,
   because failed callbacks are still billed.

## Contracts

| Contract | Chain | Role |
| --- | --- | --- |
| `AutoSaveReactive.sol` | Reactive Lasna (testnet) | Subscribes to WETH `Transfer` → saver; computes the cut; requests callbacks |
| `AutoSaveVault.sol` | Ethereum Sepolia (testnet) | Authenticated callback receiver; pulls savings via allowance; holds the ledger |

Both inherit the official
[`reactive-lib-omni`](https://github.com/Reactive-Network/reactive-lib-omni)
bases (`AbstractReactive` / `AbstractCallback`, Solidity 0.8.29, Omni
system-contract API: `SYSTEM.subscribe`, `react()` with `onlySystem`,
`SYSTEM.requestCallbackV_1_0`). The library is vendored as a git submodule
under `lib/`. All application code in `contracts/` is original, written
during the event window.

See [DESIGN.md](DESIGN.md) for the design rationale, alternatives considered,
and honest notes on what is real vs. demo. See [PROOF.md](PROOF.md) for the
deployed addresses and the transaction hashes proving the full loop.

## Development

Prerequisites: Node 20+, npm. No Foundry needed (Hardhat + ethers).

```bash
git clone --recurse-submodules <this repo>
cd <repo>
npm install
npx hardhat compile
npx hardhat test        # 17 tests: react() filtering, callback payloads,
                        # pause/resume, vault auth, clamping, withdrawals
```

## Testnet deployment

**Testnet only.** The scripts refuse to run against any chain other than
Sepolia (11155111) and Lasna (5318007). They use a throwaway deployer key in
`.deployer-key` (gitignored, mode 600) — never a real wallet.

```bash
# 0. Generate a fresh throwaway key (or bring your own testnet-only key):
node -e "import('ethers').then(async ({Wallet}) => console.log(Wallet.createRandom().privateKey))" > .deployer-key
chmod 600 .deployer-key

# 1. Fund the deployer address with Sepolia ETH from a public faucet,
#    then swap some for testnet lREACT via the official Reactive faucet:
node scripts/01-fund-lasna.js 0.05

# 2. Deploy + wire + fund both contracts' reserves:
node scripts/02-deploy.js

# 3. Run the full loop for real and record proof.json:
node scripts/03-demo-loop.js 0.01

# 4. Check balances / reserves / debt / stats any time:
node scripts/04-status.js
```

Funding notes: the Lasna faucet contract pays 100 lREACT per Sepolia ETH
(max 5 ETH per request). Lasna gas was ~100 gwei at build time, so reactions
cost roughly 0.025 lREACT each; the deploy script funds 0.5 lREACT balance +
1 lREACT reserves for the reactive contract, and 0.005 + 0.01 Sepolia ETH
for the vault.

## Security notes

- `react()` is `onlySystem`: nobody can hand the contract a fabricated log.
- `save()` requires both `onlyServiceProvider` (the callback proxy) and
  `onlyCallbackSender` (the authorized reactive contract).
- The vault can only pull WETH the saver explicitly approved, and only up to
  their balance. Savings are withdrawable by the saver at any time.
- No owner powers over user funds: the reactive owner can only change their
  own rate/minimum/vault and pause/resume; the vault has no owner at all.

## License

MIT — see [LICENSE](LICENSE).
