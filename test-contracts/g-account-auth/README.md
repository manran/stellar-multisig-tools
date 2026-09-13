# G-account Soroban authorization fixture

Minimal Testnet contract for MultiSigTools S2 end-to-end proof. It exists to test one protocol fact: a transaction source G-account can invoke a contract that requires authorization from a different G-account.

The contract intentionally has no application-specific policy:

- `authorize(actor, marker)` calls `actor.require_auth()`, then stores `(actor, marker)`;
- `last()` returns the stored pair so an E2E can prove the authorized transaction changed ledger state.

This is test infrastructure, not a production contract.

## Build

```sh
cargo test
stellar contract build
```

The optimized WASM is written to `target/wasm32v1-none/release/g_account_auth.wasm`.

## Deploy and run the live proof

Use a disposable funded Testnet identity to deploy the fixture, then run the repository E2E script with the resulting contract id:

```sh
stellar keys generate mst-deployer --network testnet --fund
stellar contract deploy \
  --wasm target/wasm32v1-none/release/g_account_auth.wasm \
  --source mst-deployer \
  --network testnet

MST_E2E_CONTRACT_ID=C... \
  npx tsx ../../scripts/liveSorobanGAccountE2e.ts
```

The live script creates fresh disposable source/actor keypairs, funds them with Friendbot, performs record simulation, signs the detached CAP-71 G-account auth entry, enforces the prepared XDR, freezes an ordinary Proposal, signs the transaction envelope with the source only, submits to Testnet, and reads `last()` back from contract state.

No test secret key is stored in the repository.

## Real Freighter 2-of-2 browser fixture

For a real wallet-module proof, first create two funded Testnet Freighter addresses and pass only their public G addresses to the preparation script:

```sh
MST_E2E_SIGNER_A=G... \
MST_E2E_SIGNER_B=G... \
MST_E2E_CONTRACT_ID=C... \
MST_E2E_XDR_OUT=/tmp/multisigtools-soroban-freighter.xdr \
  npx tsx ../../scripts/prepareSorobanFreighterE2e.ts
```

The script creates fresh disposable source/authorizer accounts. The authorizer has signer A +1, signer B +1, master weight 0, and medium threshold 2. The transaction source has signer A +1 and master weight 0. It writes one unsigned contract-call XDR for Import.

Import that XDR in Testnet Review, run RPC simulation, sign the detached auth entry with each Freighter wallet, then switch back to signer A for transaction-envelope signing. The preparation script never reads or stores either Freighter secret or recovery phrase.

## S3A/S3B contract-account fixture

The same workspace includes `contracts/simple-account-auth`, a minimal `__check_auth` account contract. S3A uses it to prove that MultiSig Tools can inspect a real C-account authorization requirement without pretending to know or validate the account contract's custom credential policy.

Build the workspace, deploy `simple_account_auth.wasm`, then use the deployed C-address as the `actor` argument to `g-account-auth.authorize`. A build-only transaction imported into Testnet Review is classified as `contract-account / contract-check-auth`, shows the invocation tree, and keeps the production Human authorization action blocked/read-only.

S3B also uses this fixture to test the contract-neutral credential transport boundary. This particular account's `Signature` type is `BytesN<64>`, so its fixture adapter signs the exact Soroban authorization challenge hash with the stored Ed25519 owner and wraps the 64-byte result as one `ScVal`. The generic MultiSig Tools core does not assume that encoding for other C-accounts: it stages the adapter-provided `ScVal`, marks it as requiring RPC enforcement, then performs enforcing simulation and re-prepares the resource footprint before envelope signing.

This contract is a protocol fixture, not an audited wallet contract or a generic production C-account adapter.
