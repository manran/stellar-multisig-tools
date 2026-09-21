# Contract Workspace

Status: architecture baseline

## Purpose

Contract Workspace is the Human workspace projection for a Soroban contract (C-address).
It is not an ownership claim and does not create authority.

Importing a contract means:

- add a contract to the user's working context;
- resolve current contract facts;
- resolve current authority paths when possible;
- expose contract operations through existing Review / Sign / Submit flows.

Import != permission.

## Relationship with Account Treasury

Account Treasury represents a G-address management workspace.

Contract Workspace represents a C-address management workspace.

They may be related through authority facts:

```
Signer
  |
  signer-of
  |
Account
  |
  controls
  |
Contract
```

## Authority

Authority comes from the Authority Graph projection.

Examples:

- signer of an admin account controlling a contract;
- contract-defined authorization;
- future delegated authority.

The projection must be refreshed and verified at action boundaries.

## Discovery

Before SAINT, discovery begins from explicit Import Contract actions and locally accumulated authority facts.

After SAINT, authority discovery can be requested by address.

MultiSigTools should consume authority discovery, not duplicate a global index.

## Implemented pre-SAINT discovery surface

Until SAINT can answer authority-graph queries, discovery is explicit and signer-scoped:

```text
/contracts
-> Add or call contract
-> inspect the C-address interface
-> Save to Contracts
-> open the Contract Workspace
-> choose a method or start a generic call
```

**Contracts** is a first-class navigation entry and `/contracts` is its collection. Saved contracts are private workspace state keyed by signer Principal and network through `/api/contracts`; browser `localStorage` is only a one-time migration source.

Every method on a Contract Workspace links directly to the contract call composer with contract, network, and method context. The composer still validates the live interface before building an unsigned call. A saved workspace is only a remembered work object; it never grants authority.

Future SAINT integration replaces discovery/resolution input, not the Human workspace model: signer login may surface Treasuries and Contract Workspaces from a SAINT authority graph without requiring each signer to import the same C-address.

## Transaction source is not a Treasury role

Contract calls keep `Transaction source` as a neutral G-account field. The signed-in account is the normal default, while an explicit account carried by the current work context wins and a Human may paste another G-address directly. The Contract Call surface must not force this choice through Treasury vocabulary or a Treasury selector.

The transaction source owns transaction sequence / fee context and envelope authorization. Contract authorization is a separate relation resolved from live Soroban/authority evidence.

A complete valid C-address auto-loads its contract interface; Load is not a separate workflow decision. Reload/Retry is secondary recovery. Contract-call transaction lifetime uses the same shared Human lifetime control as other transaction composers.

## Operation boundary

Contract UI is a consumer of the same Headless operations available to software:

- `GET /api/contract-interface` inspects a live interface;
- `POST /api/intent` creates a source-free Soroban Intent from semantic inputs, or converts a Human imported prepared XDR into an Intent;
- `GET /api/intent` reads live Intent/AUTH state;
- `PATCH /api/intent` contributes one verified detached AUTH signature;
- `PUT /api/intent` late-binds an executor/source and returns the enforced final unsigned transaction;
- `POST /api/contract-call` and `POST /api/contract-prepare` remain low-level construction/simulation primitives, not the shared authorization lifecycle;
- `GET/PUT/DELETE /api/contracts` manages signer-owned workspace context;
- `GET /api/operations` exposes the versioned operation catalog;
- `GET /api/runtime-config` exposes the deployment-owned Stellar network boundary.

Intent creation deliberately omits transaction source, sequence, fee, and lifetime. `SOURCE_ACCOUNT` Soroban authorization is rejected because it binds AUTH to the eventual transaction source; MultiSigTools requires detached authorization so AUTH can finish before executor selection. After AUTH is ready, execution preparation uses fresh source state and enforcing simulation. Envelope signatures then use the ordinary Proposal/Signing Room path. Final Stellar submission remains independently Human-authorized. See `apps/internal-docs/content/stellar/architecture/operation-architecture.md`.
