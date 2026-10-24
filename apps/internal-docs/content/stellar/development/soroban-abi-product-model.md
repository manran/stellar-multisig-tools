---
title: "Soroban ABI and Protocol Knowledge Product Model"
description: "Internal MultiSig Tools engineering documentation."
---

Status: guiding contract for MultiSigTools Soroban composition.

## Product principle

MultiSigTools separates two different kinds of knowledge:

1. **ABI knowledge** answers: "How can this deployed contract method be called safely?"
2. **Protocol knowledge** answers: "What business action does this call represent?"

ABI support is infrastructure. Protocol knowledge is an additive product layer. A protocol must never be required for MultiSigTools to coordinate a valid generic contract call.

The generic ABI baseline follows the semantics proven by Fresnica v0.6 `fresnica-soroban-abi-v1`: recursive Contract Spec types, explicit composition capability, strict shape validation before SDK encoding, and fail-closed handling for inputs without a stable guided representation.

MultiSigTools continues to use the official Stellar JavaScript SDK for Contract Spec loading and ScVal encoding. It does not create a second Soroban codec.
## Layering

```text
Deployed Contract Spec
        |
        v
Soroban ABI Foundation
  - recursive type model
  - composition capability
  - strict typed-value validation
  - official SDK ScVal encoding
        |
        v
Generic Contract Work
  - semantic Intent
  - simulation/effects
  - AUTH coordination
  - execution/evidence
        |
        v
Optional Protocol Knowledge
  - business action names
  - domain-specific field meaning
  - units/assets/constraints
  - richer Human and Agent review
```

For example, the ABI layer can safely understand Blend `submit(... requests: Vec<Request>)`. A Blend knowledge adapter may later explain `request_type=0` as Supply and render amounts/assets in protocol language. The second capability must not be confused with the first.
## Protocol knowledge is an operational enrichment surface

After the generic product contract stabilizes, protocol knowledge may grow continuously during normal maintenance. New knowledge should be data/adapters over the stable ABI and Work foundations, not forks of the coordination engine.

Each protocol interpretation must remain attributable to concrete evidence such as deployed Contract Spec, protocol documentation, verified deployment metadata, or an intentionally maintained adapter version. Unknown or changed deployments fall back to generic ABI presentation rather than inheriting stale business meaning.

Human presentation should answer "What am I doing?" and "What changes?". Agent presentation should expose stable semantic action/data codes. Raw ABI fields and ScVal/XDR remain available as evidence and advanced detail.

Protocol recognition never relaxes authorization, effects comparison, executor scope, revalidation, or signature requirements. Familiar protocols receive richer explanation, not weaker controls.

## Implementation sequence

1. Implement the recursive ABI model and composition classification in TypeScript.
2. Accept typed JSON arguments with strict recursive validation before Stellar SDK encoding.
3. Prove parity on real contracts such as Fed and Blend plus malformed synthetic vectors.
4. Keep generic JSON presentation usable even without protocol knowledge.
5. Add protocol knowledge incrementally after the generic contract is stable.
6. If Rust/TypeScript ABI safety logic begins to drift materially, extract a pure shared ABI crate/WASM boundary then; do not introduce that runtime boundary pre-emptively.
