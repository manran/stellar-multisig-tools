# Soroban authorization fixtures

Minimal Testnet fixtures for MultiSigTools Intent authorization proofs. They exist to test detached authorization independently from the eventual transaction source.

`contracts/g-account-auth` provides:

- `authorize(actor, marker)`: calls `actor.require_auth()`, then stores `(actor, marker)`;
- `last()`: returns the stored pair so an E2E can prove the authorized call reached ledger state.

`contracts/simple-account-auth` provides a minimal `__check_auth` account contract whose configured owner is one Ed25519 G-address. These are protocol fixtures, not production wallet contracts.

## Build

```sh
cargo test
stellar contract build
```

The optimized WASM files are written under `target/wasm32v1-none/release/`.

## Detached G-account Intent proof

Deploy `g_account_auth.wasm` with a disposable funded Testnet identity, then use the repository Intent proof:

```sh
stellar keys generate mst-deployer --network testnet --fund
stellar contract deploy \
  --wasm target/wasm32v1-none/release/g_account_auth.wasm \
  --source mst-deployer \
  --network testnet
MST_E2E_CONTRACT_ID=C... \
  npx tsx ../../scripts/liveSorobanIntentSourceLateE2e.ts
```

The proof uses a planning source only for recording simulation, collects detached AUTH, discards that transaction shell, chooses a different execution source, runs enforcing simulation, signs the final envelope, submits, and reads `last()` back. No test secret key is stored in the repository.

## Real wallet 2-of-2 fixture

For a wallet-module proof, create two funded Testnet signer addresses and prepare an unsigned Soroban XDR:

```sh
MST_E2E_SIGNER_A=G... \
MST_E2E_SIGNER_B=G... \
MST_E2E_CONTRACT_ID=C... \
MST_E2E_XDR_OUT=/tmp/multisigtools-soroban-freighter.xdr \
  npx tsx ../../scripts/prepareSorobanFreighterE2e.ts
```

Import that XDR through Human Review and choose **Continue as Soroban Intent**. The imported transaction shell is discarded. Each current signer opens the resulting `/a#IntentId` and contributes detached AUTH. After `authorization_ready`, choose the executor/source and materialize a fresh final transaction. The preparation script never reads or stores wallet secrets or recovery phrases.

## Configured C-account Intent fixture

Deploy `simple_account_auth.wasm` with a fresh owner public key, then use its C-address as the `actor` passed to `g-account-auth.authorize`.

For a live Testnet proof, configure only the exact deployed fixture and its owner:

```text
STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT=C...
STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER=G...
```

Create a semantic Soroban Intent for `g-account-auth.authorize(actor=C..., marker=...)`. Recording simulation initializes the detached C-account authorization window. The configured owner contributes a normal 64-byte Ed25519 signature through the same Intent PATCH path used by G-account signers; the adapter wraps that signature as the contract-defined `ScVal` evidence.

`authorization_ready` still does not build or submit a transaction. Choose a fresh executor/source afterward, materialize the final transaction, and require enforcing simulation to pass `__check_auth` before envelope signing and submission.

Unknown C-accounts and delegated credential shapes remain fail-closed unless an explicit adapter exists. MultiSigTools does not infer arbitrary C-account credential formats.

The 2026-09-15 live proof used different C-account owner and execution identities and completed Intent creation, detached custom AUTH, late-bound execution, enforcing simulation, Testnet submission, and `last()` readback successfully.
