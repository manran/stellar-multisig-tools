# MultiSigTools Workflow Architecture

**Status:** active refactor contract
**Date:** 2026-09-15

## 1. Unify the workflow, not the protocols

MultiSigTools coordinates work that requires on-chain authority. Human, signer Agent, and external Service callers may enter the system differently, and Classic and Soroban discover authority differently. Those differences remain explicit.

What is shared is the lifecycle:

```text
Business instruction
  -> Prepare
  -> Review
  -> Authorization
  -> Ready
  -> Execution routing
  -> Execute
  -> Done
```

`Ready` means required authorization is complete. It never means the network action already happened.

### Work is the universal coordination primitive

`Intent` is not the cross-protocol abstraction. **Work** is the conceptual coordination unit: business instruction, caller/policy, preparation, disclosure, authorization plan/evidence, execution policy, and result. Existing protocol objects remain the durable projections: Classic uses Request/Proposal around an exact transaction; Soroban uses Intent + AuthorizationPlan before the final transaction exists. This is an architecture boundary, not a requirement to add a new all-purpose Work store today.

Classic signatures bind the exact transaction hash, so Classic must freeze an exact transaction before authorization. Soroban detached AUTH can bind a semantic invocation before final source/sequence/fee are known. Do not add a durable Classic Intent merely for symmetry.

## 2. Business input before protocol artifacts

The preferred external-Service contract is business-first:

```text
Service describes the action
  -> MultiSigTools prepares the chain artifact
  -> signers review and authorize
```

The target Classic Service contract is business-first: a Service names the business source account and operation semantics, while MultiSigTools owns sequence, fee, lifetime, XDR construction, inspection, and source-requirement derivation. Human Payment/Transfer composers already work this way. **The current Integration Service API still accepts unsigned exact XDR for Classic Requests; moving the stable Human composers into Headless Prepare operations is a refactor target, not a completed capability.** Exact XDR remains the advanced escape hatch for clients that already own transaction construction.

For Soroban, the semantic path is already canonical: a Service names contract + method + arguments. Recording simulation discovers the actual detached `require_auth()` requirements. The Service never supplies a trusted signer list.

## 3. Protocol projections

```text
Classic
business operation -> exact transaction -> Request -> envelope signatures -> Ready

Soroban
contract call -> Intent -> detached AUTH -> authorization_ready -> Ready
```

Classic authority comes from exact-XDR transaction/operation/fee-bump source requirements plus current Stellar signer policy. Soroban authority comes from the simulated authorization entries plus current signer policy for each authorizer.
## 4. Ready enters execution routing

Ordinary source-late Soroban work may offer three execution intentions after AUTH is complete:

```text
current_client
  current verified wallet becomes the proposed execution source

handoff
  MultiSigTools prepares exact final XDR/effects evidence for another wallet, CLI, Agent, or service

multisigtools
  MultiSigTools prepares the final transaction and continues through the Proposal lifecycle for envelope signing and submission
```

These are routing intentions, not authority. After materialization, MultiSigTools still evaluates the chosen source account's live signer policy. A wallet selected as executor may itself be a multisig account and therefore require Proposal coordination.

A fixed external-Service policy may narrow routing to `external_service`. Signers then authorize only; they cannot seize final execution from the owning business system.

Every route shares the same final safety boundary:

```text
fresh source/sequence/fee/resources
  -> enforcing simulation
  -> effects comparison
  -> final envelope authorization
  -> submission
```
## 5. Human five-step projection remains stable

The Headless workflow does not create a sixth Human step. The existing Human journey remains:

```text
1 Prepare -> 2 Review -> 3 Sign -> 4 Submit -> 5 Done
```

Mapping:

- Headless Prepare -> Human Prepare.
- Headless Review -> Human Review.
- Classic envelope signatures and Soroban detached AUTH -> Human Sign.
- Ready + execution routing + execution confirmation -> Human Submit.
- Confirmed network result -> Human Done.

Inbox/Dashboard show the current viewer's next action rather than exposing internal workflow phase names. `authorization_ready` therefore projects to **Choose execution**, not directly to **Execute**.

## 6. Identity and ownership remain separate

- Human/Agent may represent a signer Principal.
- Service is a workload caller with explicit business scope, not an implicit signer.
- Team/Workspace is a future ownership/policy container, not an Actor or Principal.
- Creator provenance, authorization evidence, and execution ownership are independent facts.

## 7. Refactor gate

A UI or API change is aligned only when it preserves these distinctions and reuses the existing Request/Intent lifecycle rather than adding another state machine.
