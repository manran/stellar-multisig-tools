# MultiSigTools Box + Automation v1 — superseded machine-ownership contract

**Original milestone:** v102 / 2026-09-01  
**Superseded by:** v132 Signer Agent Access  
**Current machine contract:** `AGENT_API.md`

This file is retained only to record the earlier Box/Treasury automation experiment and the architectural decisions that survived it. The v102 rule **"Treasury Box owns an automation API key that creates Requests" is no longer a product contract**.

There are no compatibility guarantees for the retired Treasury automation credential model.

## Current ownership model

v132 makes the ordinary machine principal signer-centric:

```text
Signer Principal (network + G-address)
  -> Human session
  -> named Agent credential
       Read / Write / Sign
  -> accessible Treasury resources
  -> Inbox / Activity / Contacts / Requests
```

Treasury is a shared resource, not the normal machine principal.

Treasury Settings may separately create a fixed-scope **Treasury Audit credential**. It is an observer for that one Treasury's Activity and has no Inbox, personal Contacts, Request creation, signature contribution, final submission, or Treasury administration authority.

See `AGENT_API.md` for the normative v132 contract.

## Retained Box invariants

The following parts of the original Box work remain valid.

### Treasury Box is a shared resource boundary

```text
TreasuryBox
  network: public | testnet
  account: G...
  shared metadata.name
  administration audit
```

A Treasury Box is anchored to a classic Stellar account. Current Stellar signer state remains authorization truth. MultiSigTools metadata, names, local adoption preferences and Agent credentials never grant Stellar signing weight.

### Shared Treasury name is not a personal alias

```text
personal Address Book alias != Treasury name
Treasury metadata.name      == shared Treasury name
```

The raw Stellar address remains canonical. Shared names are private MultiSigTools metadata visible only under the existing Treasury authorization boundary.

### Personal and shared semantic data remain distinct

A future shared company/Box Contacts directory may provide common counterparty or signer names. It must not publish one participant's personal Address Book.

Recommended one-way relationship:

```text
shared contact -> explicit user copy/suggestion -> personal contact
personal contact -X-> automatic shared publication
```

Names never grant authorization.

### Human private session is not transaction signing

The security concepts remain separate:

```text
wallet connection != private-session proof != Stellar transaction signature
```

SEP-53/SEP-10 private-session proof authorizes access to private MultiSigTools data; it does not add transaction authorization.

### Cold Treasury bootstrap remains valid

High-value accounts do not need to expose their secret to MultiSigTools:

```text
public G-address
  -> load public Stellar state
  -> design signer/threshold change
  -> build unsigned XDR
  -> sign in cold/offline environment
  -> import signed XDR
  -> verify unchanged transaction
  -> explicit submit
```

A cold secret never needs to enter the browser.

### Private proposal context remains frozen once signing starts

Off-chain Private Note and on-chain Private Commitment retain the same lifecycle boundary: edit during Prepare/Review; freeze when the Signing Request begins. Corrections create a replacement proposal rather than rewriting context signers already reviewed.

### Decline remains collaboration, not Stellar authorization

A verified signer may decline a proposal. Decline is an append-only collaboration event. It does not add signature weight, cancel the XDR, or create VoteBox/governance semantics.

### Audit remains evidence, not regulatory WORM

Application audit records remain separate from ordinary logs and must exclude credential secrets, Stellar seeds/private keys, bearer capabilities, raw Authorization headers, wallet challenges, Private Note plaintext and unnecessary full XDR.

Current application append-only storage is not marketed as compliance-grade immutable/WORM storage.

### Soroban / C-address boundary remains explicit

Classic Treasury support remains `G...` account signer/threshold authorization.

```text
TreasuryBox(G...)
  classic account signers + weights + thresholds

ContractBox(C...)
ContractAccountBox(C...)
  future explicit contract authorization adapters
```

A generic contract `__check_auth()` policy must not be projected as classic `N-of-M` without a known adapter and appropriate simulation/authorization verification.

## What v132 intentionally removed

The following v102 assumptions are retired:

- Treasury-owned ordinary automation API key;
- machine credential fixed to exactly one Treasury source;
- Treasury API key as the Request-creation authorization root;
- Treasury Settings as the primary place to configure ordinary Agent access;
- the assumption that automation is primarily Treasury-dedicated rather than Human/Signer + Agent collaboration.

The replacement principle is:

> A Signer Principal delegates bounded API authority to a named Agent actor. Treasury is one of the resources that Principal can operate on. Cryptographic Stellar signer identity remains independent from Agent actor identity.
