---
title: "MultiSig Tools — Soroban Authorization"
description: "Internal MultiSig Tools engineering documentation."
---

Status: Current architecture
Date: 2026-09-14

This document is the active Soroban authorization contract for MultiSigTools. Historical S1/S2/S3 transaction-first research has been removed from this current contract; Git history preserves it, and the development archive keeps `SOROBAN_AUTHORIZATION-S1-S3-20260908-legacy.md`.

## 1. Ownership model

Soroban authorization is Intent-first:

```text
semantic Soroban Intent
  -> recording simulation
  -> immutable detached AuthorizationPlan
  -> append-only AUTH contributions
  -> authorization_ready
  -> late-bound execution source + fresh sequence
  -> enforcing simulation
  -> effects diff / explicit review when materially changed
  -> final unsigned transaction
  -> ordinary Signing Room / Proposal when envelope signing is needed
```

The durable Intent stores no transaction source, sequence, fee, timebounds, Soroban resource envelope, or transaction-envelope signatures.
## 2. SOURCE_ACCOUNT policy

MultiSigTools Intent coordination does not use Soroban `SOURCE_ACCOUNT` authorization as an optimization.

Every Stellar transaction still has a transaction source. `SOURCE_ACCOUNT` specifically means that a Soroban authorization requirement is satisfied by that source's transaction-envelope authorization. That binds AUTH to the eventual transaction source and defeats source-late execution.

Recording or imported planning that contains `SOURCE_ACCOUNT` therefore fails with `source_account_auth_unsupported`. The Human error must explain that MultiSigTools collects detached AUTH before choosing an executor and that the contract/integration must expose detached address authorization for this workflow.

No transient planning source may be promoted to durable business state.

## 3. G-account detached AUTH

Ordinary `G...` address authorization uses the Stellar auth-entry preimage for the exact network, nonce, expiration ledger, and authorized invocation tree.

- one shared expiration window is fixed before the AuthorizationPlan is stored;
- contributions are append-only and cryptographically verified;
- current Horizon signer weights and the current medium threshold remain authoritative;
- duplicate identical contributions are idempotent;
- auth-entry signatures are never treated as transaction-envelope signatures;
- `authorization_ready` is meaningful without constructing a transaction.
## 4. Configured C-account detached AUTH

A C-address authorization entry is contract/network-enforced through its account contract's `__check_auth`. The signature `ScVal` is contract-defined evidence; MultiSigTools must not interpret unknown C-account payloads as a generic signing format.

The one supported adapter is deliberately narrow: `simple-ed25519-v1`, configured by exact network + C-address + owner G-address. Configuration is provenance, not a substitute for network enforcement.

For that configured adapter:

- the AUTH challenge is derived directly from the immutable authorization entry, not from a transaction shell;
- the configured owner signs the exact auth-entry payload hash;
- MultiSigTools verifies the 64-byte Ed25519 owner signature locally;
- the adapter encodes that signature as its required `ScVal` evidence;
- the contribution uses the same append-only Intent contribution store as G-account AUTH;
- `authorization_ready` means the configured evidence is complete, not that `__check_auth` has already executed successfully;
- the late Execution step runs enforcing simulation, which remains authoritative for contract validity and resource requirements.

Unknown C-accounts, multiple detached C-account authorizers, and delegated authorization remain fail-closed until an explicit adapter/protocol is justified.
## 5. Imported prepared XDR

Import is an advanced conversion entry point, not a second coordination lifecycle.

The supported shape is one ordinary unsigned transaction containing exactly one prepared `InvokeHostFunction`. MultiSigTools extracts the HostFunction and detached AuthorizationPlan, then discards transaction source, sequence, fee, timebounds, resource shell, and other transaction identity.

Imports fail closed when they contain:

- transaction-envelope signatures;
- `SOURCE_ACCOUNT` Soroban authorization;
- unsupported or delegated credential shapes;
- unknown C-account authorization;
- pre-staged C-account custom credential evidence whose adapter provenance was not established by the Intent flow.

Configured unsigned C-account entries may be imported: their expiration window is initialized before storage and the configured owner is indexed only for discovery.

## 6. Discovery versus authority

Intent participant indexes are discovery aids only. Creator and candidate AUTH signers may be indexed so Inbox can find a resource, but every read/action revalidates live authorization facts.

For configured C-account AUTH, the configured owner is the discovery/signing principal. For G-account AUTH, current account signer policy supplies the candidate signers. Index membership never grants authorization by itself.
## 7. Execution boundary

Execution begins only after `authorization_ready`.

The caller supplies a final executor/source G-address. MultiSigTools then loads a fresh sequence and network parameters, materializes the same semantic invocation with the finalized AUTH entries, and runs RPC `authMode=enforce`.

Enforcing simulation must preserve finalized authorization entries byte-for-byte. Its effects are compared with the recording-simulation evidence fixed into the AuthorizationPlan before any final XDR is handed off. A single-signature executor may sign directly; a multisig executor uses the ordinary Proposal/Signing Room path. `Sign` authority for an Intent never implies permission to execute or submit.

Effect comparison is protocol-neutral. Plugins may translate raw ledger changes and events into better labels, but they never weaken comparison or automatically trust a known protocol. Unchanged effects continue normally. Numeric-only result drift is measured as a percentage and returned to Human/Agent reviewers; small drift may proceed with a visible warning whose severity follows the measured percentage. Large numeric drift is blocked by default with `intent_execution_effects_review_required`; a reviewer may explicitly accept that exact current numeric-effects digest, after which MultiSigTools simulates again and produces XDR only if the accepted digest is still current. Structural changes are stronger: they return `intent_execution_effects_reauthorization_required`, cannot be bypassed with `acceptedEffectsDigest`, and require a fresh AuthorizationPlan revision plus fresh AUTH. This keeps protocol recognition out of the trust model: simulation is evidence, diff is fact, and approval belongs to the signer.

## 8. Human and machine surfaces

The shared resource is `/api/intent`:

- `POST` — create semantic Intent or convert supported prepared XDR;
- `GET` — inspect Intent and live authorization state;
- `PATCH` — contribute detached AUTH as the verified Human/Agent signer;
- `PUT` — late-bind execution source, compare enforcing effects with reviewed evidence, and prepare the final unsigned transaction; large numeric drift requires explicit digest acceptance, while structural change requires re-plan and fresh AUTH.

The Human `/a#IntentId` page carries only an Intent id. Opening it does not grant authority; the wallet session must prove that the viewer is the creator or a current authorization signer.

Guided Contract Call asks only for contract, method, arguments and private context before authorization. Transaction source and transaction lifetime are not early Intent inputs.
## 9. Verified protocol evidence

Testnet proofs have established both required properties:

- detached G-account AUTH survives replacing the recording/planning source with a different final executor/source;
- the configured Simple Ed25519 C-account credential passes real `__check_auth` enforcement when its adapter-defined evidence is staged correctly.

The current product combines those facts: G-account and configured C-account authorization both live on the source-free Intent; transaction construction and enforcing simulation occur only at the late Execution boundary.

## 10. Non-goals

This architecture does not introduce a generic smart-wallet adapter registry, passkey/WebAuthn flow, delegated-auth signer, generic C-account discovery protocol, custody, or an MST Relay service. New credential shapes remain unsupported until a concrete protocol/application requirement justifies an explicit adapter and real network proof.
