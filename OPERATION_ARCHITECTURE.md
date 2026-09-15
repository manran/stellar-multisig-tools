# Operation Architecture

**Status:** active product and architecture constraint

## Product neutrality

MultiSigTools is an operation base for Humans, Agents, bots, scripts, wallets, and external clients such as Fresnica CLI.
No consumer owns a separate business lifecycle.

The governing rule is:

> A business capability must first exist as a Headless, composable, machine-callable operation. Web UI, HTTP, MCP, Skills, CLI, and plugins are consumers or adapters of that operation.

Headless does not mean “wrap a UI flow in an endpoint.” It means the operation has stable input, output, authorization, effects, errors, and evidence without depending on a page, browser storage, or click sequence.

## One operation core

    Human Web UI ─┐
    Fresnica CLI ─┤
    Agent / bot ──┼─> transport adapter ─> operation core ─> Stellar / private state
    Script / SDK ─┤
    MCP / Skill ──┘

Transport adapters may authenticate, decode HTTP, and present results. They must not redefine Stellar transaction semantics, authorization rules, Request state, resource preparation, or retry behavior.

A consumer is not required to become a thin HTTP client. Web UI may call an operation through HTTP or execute the same operation core in-browser when the trust and runtime boundary permits it; native Swift/Kotlin, Fresnica CLI, bots, and plugins may implement their own presentation and transport. Product neutrality requires contract and conformance parity, not one shared rendering stack or mandatory network hop.

## Authority model: shared lifecycle, different callers

Headless unifies the **work lifecycle**, not every identity into one role.

```text
Caller / workload identity          Chain authority
--------------------------          ---------------
Human signer session  ----------->  Signer Principal (verified G-address)
Signer Agent credential ----------> Signer Principal (delegated, exactly one)
Integration Service  -------------> no signer Principal implied
Request capability   -------------> request-scoped access only
```

An Integration Service is an independent workload identity. Its credential is restricted by deployment-owned business scope (for example allowed Classic source accounts or exact Soroban contract methods), but that scope never satisfies Stellar signatures or Soroban `require_auth()`.

Classic and Soroban therefore discover authority differently:

- **Classic**: exact XDR determines transaction source, operation source, and fee-bump source authorization domains. A Service-created Request may proceed only when every resulting `sourceRequirement` is within the Service's configured Classic source-account scope. Current signer weights/thresholds are then loaded from Stellar.
- **Soroban**: semantic Intent + recording simulation determines detached `require_auth()` authorizers. A Service is scoped to contract/method; it does not declare those authorizers.

Execution ownership is a third concern and is stored separately from caller identity. The same Service may create a Classic Request that MultiSigTools submits after Human review, while another scoped work item remains externally executed by the Service.

A future **Team / Workspace / enterprise account is not another Actor or Principal**. It is an optional ownership/policy container that may own Humans, Service credentials, shared metadata, webhooks, or resource policy. Workspace membership must never become Stellar/Soroban authorization evidence.

## Operation contract

Every promoted operation defines:

- a stable id and explicit version;
- bounded, validated input and structured output;
- Principal, Actor, and required access;
- whether it is read-only, changes private state, changes coordination state, or submits to Stellar;
- idempotency and retry behavior where a durable or financial effect exists;
- typed error codes that clients can branch on without parsing Human copy;
- canonical evidence and the live network facts that must be rechecked.

An operation output should be usable as another operation's input. Browser history, React state, DOM text, and localStorage are never authoritative operation interfaces.

## Authorization boundary

Product neutrality does not flatten permissions:

- a Human session and an Agent credential may represent the same signer Principal while remaining different Actors;
- Read, Write, Sign, and future Submit/Execute authority remain distinct;
- building unsigned XDR does not sign, authorize, or submit it;
- a saved Contract Workspace is private work context, not contract authority;
- Stellar and Soroban authorization is verified again at signing and submission boundaries;
- final network submission remains Human-only until a concrete policy-controlled machine execution capability is designed.

## Canonical composition

Soroban contract work is Intent-first. Transaction construction is deliberately later than contract authorization:

    contract.interface.inspect
    -> contract.intent.create
    -> contract.intent.contribute (until detached AUTH is satisfied)
    -> contract.intent.execution.prepare (late-bind executor/source)
    -> proposal.create / proposal.contribute
    -> proposal.submit

**contract.intent.create** stores semantic contract intent plus an immutable detached AuthorizationPlan; it does not persist a transaction source, sequence, fee, lifetime, or envelope. **contract.intent.contribute** stores verified Soroban AUTH contributions independently of the plan. Only after authorization is ready does **contract.intent.execution.prepare** choose an execution source, load a fresh sequence, materialize the final transaction, and run enforcing simulation. If envelope multisig is required, the resulting XDR enters the ordinary Proposal lifecycle.

`SOURCE_ACCOUNT` authorization is intentionally rejected by the Intent workflow because it binds contract authorization to the final transaction source and defeats source-late execution. Integrations must expose detached address authorization instead.

`contract.call.build` and `contract.call.prepare` remain low-level public construction/simulation primitives for inspection, diagnostics, and external tooling. They are not the canonical shared-authorization lifecycle.

## Shipped operation discovery

A client that knows only the deployment origin can discover the operation contract without parsing UI:

- the root response and HTML document advertise `/openapi.json` with the standard `service-desc` link relation;
- `/openapi.json` is the OpenAPI 3.1 transport contract and states the deployment-owned Stellar network;
- `GET /api/operations` returns the machine-readable v1 business-operation catalog, with an OpenAPI path/method pointer for every operation;
- `/developers` is advertised with `service-doc` for Human-readable authority and integration guidance.

Each stable business operation is exposed through the operation catalog and OpenAPI. The `/api/intent` resource uses HTTP method semantics for create, inspect, AUTH contribution, and late execution preparation.

The first complete Contract vertical slice is:

| Operation | HTTP | Access | Effect |
| --- | --- | --- | --- |
| **runtime.config.inspect** | GET /api/runtime-config | Public | None; returns deployment network policy |
| **contract.interface.inspect** | GET /api/contract-interface | Public | None |
| **contract.intent.create** | POST /api/intent | Principal Write | Coordination state; source-free Intent |
| **contract.intent.inspect** | GET /api/intent | Principal Read | None |
| **contract.intent.contribute** | PATCH /api/intent | Principal Sign | Append verified detached AUTH |
| **contract.intent.execution.prepare** | PUT /api/intent | Principal Write | Late-bind source; build/enforce final unsigned TX |
| **contract.call.build** | POST /api/contract-call | Public | Low-level unsigned XDR construction |
| **contract.call.prepare** | POST /api/contract-prepare | Public | Low-level recording simulation + assembly |
| **contract.workspace.list** | GET /api/contracts | Principal Read | None |
| **contract.workspace.keep** | PUT /api/contracts | Principal Write | Private state |
| **contract.workspace.forget** | DELETE /api/contracts | Principal Write | Private state |

The existing **/api/request** resource remains the canonical proposal create/read/contribute interface. There is no second automation Request type.

## Consumer rules

The Web contract surfaces consume the same HTTP operations available to external clients:

- Contract interface display does not load a second UI-owned ABI model;
- the guided form creates **contract.intent.create** directly from contract + method + arguments;
- **/contracts** reads signer-owned workspaces from the private service;
- old browser-only contract references are migration input, not continuing truth;
- links may carry navigation context such as contract and method, but URLs never grant authority.

A CLI or Agent can inspect a contract, build an unsigned call, review the returned XDR locally, and pass it into the shared authorization/Request lifecycle. Fresnica CLI may therefore be a first-class consumer without embedding MultiSigTools Web behavior.

## Change gate

Before merging a new business feature, verify:

1. Can the capability run without rendering the UI?
2. Do Human and machine clients call the same operation core?
3. Are input, output, access, effects, errors, and retry semantics explicit?
4. Can another client compose the result without scraping text or recovering browser state?
5. Are signing and submission boundaries still explicit?

If any answer is no, the capability is still a UI implementation detail and is not complete.
