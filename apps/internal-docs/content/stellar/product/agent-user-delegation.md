---
title: "AI Agent identity and delegation after unified MST User ID"
description: "How walletless people, signer-owned Agents, and service integrations coexist without conflating API authority with Stellar signatures."
---

## Decision

**MST User ID is the stable business identity; a Stellar G address is an independent chain signer.**
An AI Agent is a named, revocable **actor**, not an authentication method impersonating a person and not automatically a Stellar signer.

Preserve all three integrations:

| Existing/new actor | Authentication | Authority source | Chain signing |
| --- | --- | --- | --- |
| Human | SEP-53 wallet or WebAuthn Passkey | User-ID Template grants; signer/Request checks | Current Stellar signer authorization only |
| Signer-owned Agent (existing) | `msa_...` bearer | Network + signer G address, Read/Write/Sign | Sign is signature contribution only; verify actual Stellar evidence |
| Service integration (existing) | `msi_...` bearer | Explicit source-account/contract scope | Existing approval and chain verification |
| **User-delegated Agent (next)** | Separate machine credential | Explicit, revocable User-ID + Template grant | **No Stellar signing authority from the credential** |

Do not reinterpret existing `msa_` tokens as User-ID credentials. Do not automatically convert a user's Passkey into an Agent secret. Do not give an Agent a person's browser cookie.

## Authorization model

```text
MST user (stable UUID)
  ├── login credential(s): Passkey and/or verified Stellar wallet
  └── named delegated Agent(s)
        └── machine credential -> scope -> Template grant -> Request
Stellar account / signer G... -> ledger signatures (independent path)
```

The delegated Agent has a distinct `agent_id`, `owner_user_id`, credential identifier, display name, creation/revocation audit and per-network scope. Only an authenticated owner may create, rotate or revoke its credential. The raw token is displayed once; store only a cryptographic verifier, not the token. Credential identity, ownership and granted permissions must be checked **server-side on every operation**.

For first implementation, grant only `template:read`, `request:create` and `request:read_own` for **one fixed Payment Template**. Use existing User-ID Template grants; require both the owner User grant and active Agent delegation at request creation. Recheck Template availability, immutable payment fields, and current Treasury signer state immediately before durable write. Allow only Template-supported amount and Memo inputs; do not accept arbitrary XDR. Apply `Idempotency-Key` to every Agent create operation.

All Agent-created Requests retain **both** `proposer_user_id` and `created_by_agent_id` in durable audit/projection. Revoking an Agent stops new writes, not historical receipt access for the user. Revoking the User Template grant must also prevent all the user's delegated Agents from creating new Requests. Audit actor and on-chain signer separately.

An Agent credential never grants `sign`, Request submission, signer management, user credential management, invitation issuance, delegation management, or arbitrary payment destinations. If an Agent independently owns a Stellar key, use the **existing signer-owned Agent** model and current chain-policy verification; that is a separate identity/capability, not a promotion of its User delegation.

## First implementation sequence

1. Finish PR #44 Testnet migration/real HTTPS WebAuthn E2E and abuse controls. Keep PR draft; Mainnet unchanged.
2. Add `mst_user_agents` and `mst_user_agent_credentials` in a **new** migration (do not rewrite applied `0017`). Add a narrowly scoped authentication branch in machine caller resolution, distinct token prefix from `msa_` and `msi_`.
3. Provide signed-in user's Agent management: create, list, rotate, revoke. Never return a secret again after issuance. Separate roles, names, and last-used metadata.
4. Extend existing Template Payment Request creation (not a new Request subsystem). Enforce owner grant, Agent grant, Template invariants and rate limits in the service layer. Record immutable Agent attribution and idempotent Request creation.
5. Test: no-G-address Agent create succeeds within grant; unauthorized Template, revoked Agent, revoked User grant, forged credential, wrong network, arbitrary XDR, duplicate idempotency key, signing/submission attempt all fail correctly. Test owner audit and ledger receipt visibility.

## Testnet security gate

Review all public identity actions: `invitation_preview`, `registration_options`, `registration_verify`, `authentication_options`, `authentication_verify`, `invitation_accept`, `create_invitation` and revocations. Current `routes/identity.ts` does not invoke the existing `enforceSemanticRateLimit` helper. The latter uses Vercel Firewall, which must **not** be assumed active at the self-hosted Testnet API. Require an effective gateway or backend rate limit by source IP plus action; cap active challenges and invitations, apply separate per-user/token quotas after authentication, and observe HTTP 429 without revealing account existence. Reject unsafe cross-origin requests and audit missing Origin behavior for cookie-backed writes.

Do not merge #44 or enable Mainnet until migration rollback, real HTTPS WebAuthn, revocation, rate limits, and ledger E2E are accepted.
