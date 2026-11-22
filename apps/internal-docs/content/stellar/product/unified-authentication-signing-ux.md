---
title: "Unified login and signing — product interaction contract"
description: "One MST identity, many login credentials, and transaction-scoped signing decisions."
---

## Product rule

**Login establishes who is coordinating. Signing establishes who is authorized for this exact on-chain action.** The two must never be conflated.

- One durable MST User ID; multiple linked Passkeys and verified wallets.
- Wallet and Passkey are equal **login** methods, not automatically equal chain signers.
- An AI Agent has a separate scoped workload credential; it is never silently presented as a person's Passkey.
- Login should not require a G address, network activation, an invitation, or a payment.
- Signatures always authorize a specific immutable transaction or Soroban auth entry after review.
- No implicit creation, transfer, funding, or recovery of a Soroban smart account during login.

## First visit

The account entry page has **Continue with Passkey**, **Create a new Passkey account**, and **Continue with Stellar wallet**.

1. Returning Passkey: discoverable WebAuthn authentication -> same User ID -> Inbox.
2. New Passkey: verified WebAuthn registration -> one MST User ID -> personal workspace. A Template invitation can be redeemed while registering, but is not required to have an account.
3. Wallet: fresh SEP-53 proof -> existing/lazily created MST User ID. The user can add a Passkey later.
4. Invitation: explains what authority is granted before authentication; a new Passkey creation consumes its one-use grant atomically.
5. Existing Passkey + wallet: link only after independent proofs; a wallet already linked to another User ID is never auto-merged. A connected wallet must not silently replace the active Passkey user's Inbox or history.

If both login sessions exist, the valid Passkey session remains the active MST User ID; a wallet can expose chain-signer authority **only when it is verified and linked to that User ID**. A different connected wallet remains a usable independent signer for supported transaction flows, but cannot grant User-ID business access or silently switch the account. Users can explicitly sign out of Passkey to access the other wallet's account.

## Sign one Proposal

```text
Open Proposal
  -> understand operation, recipient, asset, amount, policy and private context
  -> determine each live authorization requirement
  -> find currently available eligible signer credentials
  -> if exactly one: show primary "Sign with [method]"
  -> if more than one: choose method for **this signature**, not at login
  -> if none: offer authorized signer/approval route, not a fake sign button
  -> fresh cryptographic consent for the exact payload
  -> show contribution and separately show final ledger execution
```

Do not ask users to choose a signer before knowing which credentials meet this action's current policy. In multi-authorizer Soroban Intents, choices are **per authorization requirement**, not one global signer switch. Keep source/executor selection separate from detached AUTH.

| Authorization requirement | Currently usable method in MST | Passkey behavior |
| --- | --- | --- |
| Classic Stellar G-account transaction signature | Eligible G-wallet | Login only; cannot sign Classic |
| Soroban detached G-address AUTH | Eligible wallet with AUTH-entry signing support | Login only |
| Configured `simple-ed25519-v1` C-account | Configured G owner wallet | Login only |
| Future C smart account enrolled with WebAuthn | Valid enrolled Passkey, supported `__check_auth` adapter | Fresh WebAuthn signature of Soroban auth digest |
| Off-chain Template proposer | Verified MST User ID or scoped Agent | May prepare, cannot infer chain permission |

MST should not display a Passkey signing option for an unknown or unconfigured C account. Before enrollment/real Testnet verification, label Passkey only as a login method.

## Smart-account enablement (future explicit user action)

1. Show a clear explanation of the smart account and recovery options; ask the user to opt in.
2. Use a separately audited Stellar smart-account implementation and WebAuthn verification adapter; do not generate bespoke wallet WASM per Template.
3. Bind the Passkey's public credential to the C account through an authorized on-chain registration.
4. Display which account/Template/scope it can sign, using live chain facts.
5. For every authorization, show exact effects, prepare the correct network/nonce/expiration/invocation auth digest, request fresh WebAuthn consent, and attach only verified evidence.
6. Support explicit alternative signers/recovery and independent fee payer; no MST-held unilateral upgrade or asset authority.
7. Preserve Private Note off-chain; chain records independently verifiable rule/authorization and final transaction facts.

A shared Passkey credential may be used for both MST login and on-chain C-account signing, but registration, payload, verifier and user consent remain distinct. The RP ID is domain-bound, so independent access/recovery must be designed before recommending it as the only chain key.

## Release sequence

- **Phase A (this PR):** equal wallet/Passkey login entry, walletless account creation, linked-method management, stable active User ID and accurate Classic signing copy. Keep #44 Draft.
- **Phase B:** secure Testnet PostgreSQL migration, real HTTPS registration/authentication, limits on public identity endpoints, wallet linking, invitation and Classic signing E2E. Do not merge until gates pass.
- **Phase C:** independently proven Soroban C-account Passkey authorization, smart-account opt-in/recovery and explicit per-authorization method picker. Gate on enforcing simulation and on-chain wrong-signature rejection.
- **Phase D:** opt-in Template deployment/Policy Vault, Agent constrained execution, ledger receipts correlated to private governance history.

Do not imply Phase C is implemented just because the WebAuthn login succeeded.
