# DESIGN.md — AutoSave (Reactive Omni Buildathon, "Set It and Forget It")

## The idea

**AutoSave: every WETH payment you receive automatically sets aside a cut into
on-chain savings — no bot, no keeper, no app to open.**

A freelancer or creator sets a savings rate once (say 10%) and approves the
vault. From then on, every time WETH lands in their wallet, a reactive
contract notices the transfer on Sepolia, and a callback on Sepolia pulls the
savings cut into their personal savings ledger. They can withdraw it any time.
Set it once, forget it forever.

## Why this fits the track

- **Personal automation anyone can understand.** "Save 10% of everything I
  get paid" is a real habit people want; today it needs a bot or discipline.
- **The reactive contract does real work.** It filters by recipient at the
  subscription layer (topic2 = user), enforces a minimum payment, computes the
  savings cut, tracks stats, and decides whether a callback is warranted. It
  is not bolted on: without it, nothing happens.
- **Real origin events.** The trigger is `Transfer` on the canonical WETH9
  contract on Ethereum Sepolia (`0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`),
  verified live: 379 Transfer logs in a 500-block window on 18 Nov 2026.
  The demo triggers it with a real WETH transfer anyone can inspect.
- **Full loop, both chains.** Origin event (Sepolia) → reactive transaction
  (Lasna) → callback transaction (Sepolia). Every hop is a real transaction
  with a hash, recorded in PROOF.md.

## Architecture

```
  Sepolia (origin + destination)              Lasna (Reactive)
 ┌─────────────────────────────┐            ┌──────────────────────────┐
 │ WETH9 (canonical)           │ Transfer   │ AutoSaveReactive         │
 │  user receives WETH payment │──event────▶│  - subscribed: Transfer, │
 └─────────────────────────────┘            │    topic2 == user        │
                                            │  - min payment + save %  │
 ┌─────────────────────────────┐  callback  │  - requests callback     │
 │ AutoSaveVault (callback)    │◀───────────│  - stats + pause/resume  │
 │  - pulls save cut via       │            └──────────────────────────┘
 │    transferFrom (allowance) │
 │  - per-user savings ledger  │
 │  - withdraw() any time      │
 └─────────────────────────────┘
```

### Contracts (all original, written 18 Nov 2026 during the event)

1. **`AutoSaveReactive.sol`** (Lasna, `AbstractReactive`)
   - Subscribes in the constructor: chain 11155111, WETH address, topic0 =
     `Transfer(address,address,uint256)`, topic2 = the user's address,
     other topics ignored.
   - `react()`: onlySystem; decodes the WETH amount from `log.data`; skips
     (no revert) when paused, below `minPayment`, or savings rate is 0;
     otherwise requests a callback to the vault with `(user, saveAmount)`.
   - Owner controls: `setSavingsRate`, `setMinPayment`, `pause`/`resume`
     (unsubscribe/subscribe + `_coverDebt()`), `setVault`, `coverDebt`,
     `withdraw` (rescue surplus lREACT).
   - Stats: `paymentsSeen`, `totalReceived`, `totalSaved`, `lastSaveAt`.

2. **`AutoSaveVault.sol`** (Sepolia, `AbstractCallback`)
   - Constructor takes the Sepolia callback proxy
     (`0xAa14d9Cd0f788Ca23d11805986C1d8bd035D23b4`) and the reactive
     contract address (immutable `_CALLBACK_SENDER`).
   - `save(address reactive_, address user_, uint256 amount_)`:
     `onlyServiceProvider` + `onlyCallbackSender`; pulls
     `min(amount, allowance, balance)` WETH from the user via `transferFrom`
     (clamped so it never reverts on insufficient allowance), credits
     `savings[user_]`, emits `Saved`.
   - `withdraw(uint256 amount_)`: user reclaims their saved WETH any time.
   - `coverDebt()` exposed for the proxy's billing; `receive()` payable.

### Funding / economy (testnet only)

- Reactive contract: funded with lREACT (balance + `depositTo` reserves) so
  the system contract can charge `react()` executions. Lasna gas price at
  build time: 100 gwei; fee per reaction ≈ gas price × (gas used + 100k
  surcharge).
- Callback contract: funded with Sepolia ETH reserves via the callback
  proxy's `depositTo`, so callbacks are delivered and billed in Sepolia ETH.
- lREACT source: the official Reactive faucet (send Sepolia ETH to
  `0x9b9BB25f1A81078C544C829c5EB7822d747Cf434`, 1 ETH → 100 lREACT).
- Sepolia ETH source: the Sepolia PoW faucet (mining, no account).

## Alternatives considered

- **DipBuyer on Chainlink feeds:** Chainlink `AnswerUpdated` events cannot be
  triggered on demand on testnet, so the demo loop could not be proven
  end-to-end on schedule. Rejected for reliability.
- **Gas-threshold executor:** gas price is not an event; would need CRON
  polling with no origin-chain signal. Weak integration story. Rejected.
- **LP guard on Uniswap Sync events:** no reliable, liquid Uniswap V2 pair
  confirmed on a supported testnet that the demo could move. Rejected.
- **Own origin contract emitting synthetic events:** reliable but weaker
  ("the demo triggers its own signal"). Kept as fallback only; not needed —
  WETH Transfer is real, canonical, and triggerable.

## Honest notes (what is real vs. demo)

- REAL: the reactive subscription, the `react()` execution on Lasna, the
  cross-chain callback delivery, the WETH pull and savings ledger on Sepolia.
  All transactions are on public testnets and linked in PROOF.md.
- DEMO: the "payment" is the author's own testnet WETH transfer, and the
  vault is funded/approved by the same testnet wallet. That is the nature of
  a testnet demo; the mechanism is identical for any user who configures
  their own address, rate, and allowance.
- The savings cut is pulled from the user's wallet via a pre-approved
  allowance — the vault never custodies funds it was not authorized to move,
  and savings are withdrawable by the user at any time.

## Risks

- Faucet availability (PoW mining rate, captcha) gates all testnet funding.
- Lasna gas price (100 gwei at build time) makes reactions pricier than
  expected; funding sized accordingly.
- Callback delivery latency is network-dependent; the demo allows minutes
  between the origin event and the callback landing.
