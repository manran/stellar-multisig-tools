# MultiSigTools Audience Projection Model

Status: active product/architecture guidance
Date: 2026-09-17

## 1. Purpose

MultiSigTools keeps one rigorous coordination core, but different callers should not be forced to consume the same technical presentation.

The shared fact model remains:

```text
Business instruction
-> preparation/review facts
-> authorization requirements/evidence
-> Ready
-> execution routing
-> execution evidence/result
```

The product surface is audience-specific:

```text
same Work facts
├─ Human       -> Task presentation
├─ signer Agent -> typed Task
└─ Integration -> Job
```

The rule is: **share facts and safety boundaries; project language and next actions for the audience.**
## 2. Projection invariants

1. A projection is derived state, never a second workflow engine.
2. Reuse the existing Request/Intent id; do not invent Task/Job identities.
3. Authorization, disclosure, and execution ownership remain separate.
4. A projected next action is advice, not permission; the API operation revalidates authority.
5. `Ready` means required authorization is complete, not that the network action happened.
6. `created` is normally an event, not a long-lived state.
7. Technical facts remain available for diagnostics and advanced clients.
8. Human text is not a machine contract; Agents and Services receive stable typed codes.
9. Do not force protocol symmetry where Classic and Soroban materially differ.
10. Do not create a universal `/api/work` merely to make the projections look alike.

## 3. Human projection — answer one question

The Human surface answers:

> What do I need to do now?

Primary Human screens should expose one principal action, or clearly say that no action is currently available. Internal status names, AuthorizationPlan revisions, executor binding, and evidence mechanics belong in Advanced/details surfaces.

The stable Human journey remains:

```text
Prepare -> Review -> Sign -> Submit -> Done
```
Human action language should converge across protocols:

```text
Review & sign
Choose execution
Review & submit
View status
Review issue
```

Classic envelope signing and Soroban detached AUTH are technically different, but both are a signer action in the Human product. Primary Inbox/Dashboard copy should therefore say **sign**, not make ordinary users choose between “signature” and “contract authorization” taxonomies.

Status and viewer action remain different facts. For example, authorization may be globally complete while a signer has no execution ownership; that viewer sees `View status`, not an execution CTA.

Human presentation may include protocol-specific context such as “Contract call” or “Payment” to explain what is being signed. It should not expose protocol-specific workflow vocabulary merely to describe the action.

## 4. Signer Agent projection — typed Task

A signer Agent is different from an Integration Service: it acts for one signer Principal and its credential has an explicit Read/Write/Sign capability level.

The Agent surface answers two questions:

```text
What does this Principal need to do next?
Can this credential perform that action?
```

Agents must not infer those answers by parsing Human copy or reproducing MultiSigTools state-machine rules.
The business projection is named `task`, not `job`, because the Agent is a delegated actor rather than the owner of an external business workflow.

Minimum shape:

```json
{
  "version": 1,
  "id": "...",
  "kind": "classic_transaction",
  "state": "action_required",
  "nextActions": [
    {
      "code": "contribute_signature",
      "requiredAccess": "sign",
      "available": true
    }
  ]
}
```

Initial Task states are deliberately actor-oriented:

```text
action_required
waiting
completed
expired
failed
cancelled
```

These are projections, not replacements for Request status or Soroban authorization status.
Initial Agent action codes:

```text
contribute_signature      # Classic signer evidence
contribute_authorization  # Soroban detached AUTH
decline                   # non-cryptographic Request collaboration
prepare_execution         # materialize a permitted Soroban execution package
refresh_execution         # rebuild a stale/lost Soroban execution package
replan                    # refresh expired Soroban authorization
cancel                    # creator-owned coordination cancellation; does not revoke disclosed Stellar AUTH/XDR
```

Each action reports its minimum Agent access level and whether the current credential satisfies it. `available=false` is useful information: the Principal may need to sign even when the current Read/Write credential cannot do so.

A creator Agent with Write access may receive `cancel`; non-creator signer Agents do not. `cancelled` is terminal for Task/Job/Human workflow projection, but the underlying evidence remains inspectable. The Task should optionally project `waitingFor`, expiry and confirmed result facts when they are useful. It must not copy raw signatures, raw AUTH XDR, private capability secrets, or make an Agent credential look like chain authority.

Agent `task` is additive to existing technical Request/Intent fields. MCP, Skills and SDK adapters should consume `task` before reimplementing workflow branching themselves.

## 5. Integration projection — Job

The Integration `job` contract remains governed by `INTEGRATION_PRODUCT_MODEL.md`.

A Job answers what the owning business system should do next. It is not Principal-oriented and therefore does not expose Agent credential capability checks.

```text
Service -> Job
Signer Agent -> Task
Human -> one current action
```

Do not collapse these three into one DTO merely because they derive from the same Work facts.
## 6. Shared derivation, separate presentation

The preferred implementation shape is pure projectors over authoritative facts:

```text
Request / Intent / authorization / evidence / caller
                    |
                    +-> Human viewer action
                    +-> Agent Task
                    +-> Integration Job
```

Projectors must be deterministic and unit-tested. They may share small fact helpers, but there is no requirement for a universal `WorkProjection` object.

If the same safety rule appears in three projectors, move the factual derivation down one layer. Do not move audience wording or role-specific permissions into the domain model.

## 7. Delivery order

Phase A — Human language convergence:
- use one signer action vocabulary across Classic and Soroban;
- collapse “contract auth” vs “signature” counters into Human `to sign` presentation where they mean the same user action;
- preserve protocol detail inside Review/Advanced.

Phase B — Agent Task projection:
- add pure Classic and Soroban Task projectors;
- expose `task` additively on Agent-owned create/inspect/action responses;
- include required access + availability rather than forcing the Agent to infer credential capability;
- document in OpenAPI and `AGENT_API.md`.

Phase C — event/SDK ergonomics:
- Integration gets reliable webhook/outbox with PostgreSQL;
- Agent adapters/SDK consume typed Task rather than polling technical fields blindly;
- do not add a generic event bus until an Agent event consumer actually requires one.
## 8. Non-goals

This refinement must not create:

- another persisted Task/Job/Work state machine;
- a new identity distinct from Request/Intent ids;
- Human UI that displays machine action codes;
- Agent logic that parses Human-facing prose;
- Service credentials that inherit signer capabilities;
- automatic execution merely because authorization is ready;
- duplicated protocol authorization logic in presentation code;
- forced Classic/Soroban structural symmetry.

## 9. Product test

A projection is successful when each audience can answer its operational question without learning irrelevant implementation concepts:

```text
Human:       “What do I do now?”
Signer Agent:“What does my Principal need, and can this credential do it?”
Integration: “What should my business system do next?”
```

If the answer requires the caller to understand AuthorizationPlanRevision, contribution storage, execution-preparation history, or viewer-permission inference, the projection is incomplete.