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

A contract workflow composes existing operations instead of creating a Contract-only signing lifecycle:

    contract.interface.inspect
    -> contract.call.build
    -> contract.call.prepare
    -> contract.authorization.create / contribute / freeze (when required)
    -> proposal.contribute
    -> proposal.submit

**contract.call.build** returns unsigned transaction XDR based on fresh source sequence and fee data. **contract.call.prepare** runs recording simulation and assembles current resource/auth requirements; Review consumes this operation instead of owning RPC semantics. Shared authorization uses the existing `/api/preparation` resource. Its freeze operation runs enforce simulation after authorization is final, reassembles the returned resources without fixed leeway, and creates the ordinary immutable Proposal. Consumers may stop after any non-side-effecting step or hand the output to a different compatible client.

## Shipped operation discovery

A client that knows only the deployment origin can discover the operation contract without parsing UI:

- the root response and HTML document advertise `/openapi.json` with the standard `service-desc` link relation;
- `/openapi.json` is the OpenAPI 3.1 transport contract and states the deployment-owned Stellar network;
- `GET /api/operations` returns the machine-readable v1 business-operation catalog, with an OpenAPI path/method pointer for every operation;
- `/developers` is advertised with `service-doc` for Human-readable authority and integration guidance.

One HTTP transport may carry more than one business operation. For example, authorization contribution and refresh intentionally share `PATCH /api/preparation`; OpenAPI records both stable ids in `x-multisig-operation-ids` rather than inventing duplicate endpoints.

The first complete Contract vertical slice is:

| Operation | HTTP | Access | Effect |
| --- | --- | --- | --- |
| **runtime.config.inspect** | GET /api/runtime-config | Public | None; returns deployment network policy |
| **contract.interface.inspect** | GET /api/contract-interface | Public | None |
| **contract.call.build** | POST /api/contract-call | Public | None; returns unsigned XDR |
| **contract.call.prepare** | POST /api/contract-prepare | Public | None; recording simulation + assembly |
| **contract.authorization.create** | POST /api/preparation | Principal Write | Coordination state; idempotent for Agents |
| **contract.authorization.inspect** | GET /api/preparation | Principal Read | None |
| **contract.authorization.contribute** | PATCH /api/preparation | Principal Sign | Coordination state |
| **contract.authorization.refresh** | PATCH /api/preparation | Principal Write | Coordination state |
| **contract.authorization.freeze** | PUT /api/preparation | Principal Write | Enforce/reassemble into Proposal |
| **contract.workspace.list** | GET /api/contracts | Principal Read | None |
| **contract.workspace.keep** | PUT /api/contracts | Principal Write | Private state |
| **contract.workspace.forget** | DELETE /api/contracts | Principal Write | Private state |

The existing **/api/request** resource remains the canonical proposal create/read/contribute interface. There is no second automation Request type.

## Consumer rules

The Web contract surfaces consume the same HTTP operations available to external clients:

- Contract interface display does not load a second UI-owned ABI model;
- the guided form sends typed string inputs to **contract.call.build** and receives XDR;
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
