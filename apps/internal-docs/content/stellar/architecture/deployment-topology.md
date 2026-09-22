---
title: "MultiSig Tools Deployment Topology"
description: "Internal MultiSig Tools engineering documentation."
---

**Status:** Approved architecture
**Updated:** 2026-09-22

This document is the canonical deployment-boundary contract for MultiSig Tools.

## 1. Namespace model

MultiSig Tools separates three dimensions:

```text
product      = multisig.tools
protocol     = /stellar
environment  = deployment/domain
```

The protocol path is a product namespace. It is not a runtime network selector.

Mainnet and Testnet are separate deployments with separate configuration, databases, secrets, queues, credentials, and operational gates.

## 2. Public surfaces

### Human application

```text
Mainnet   https://stellar.multisig.tools
Testnet   https://stellar-testnet.multisig.tools
```

Both deployments use the same Stellar Web application code. Mainnet may remain a holding surface while Testnet continues running.

### Public API

```text
Mainnet   https://api.multisig.tools/stellar
Testnet   https://api-testnet.multisig.tools/stellar
```

`api.multisig.tools` and `api-testnet.multisig.tools` are namespace gateways.

They do not own Stellar business logic.

The gateway may:

- route by the first protocol path segment;
- expose protocol discovery;
- preserve request/response transport;
- apply generic transport/security headers;
- carry a correlation id if required.

The gateway must not:

- authenticate `msi_*`, Agent, Human, or Stellar identities;
- choose Mainnet/Testnet from request data;
- access a coordination database;
- interpret Request/Intent authority;
- validate XDR/AUTH;
- own webhook, Queue, managed-channel, or transaction logic.

A protocol backend remains independently secure if addressed without the gateway.

## 3. Stellar API service

The real Stellar API begins behind the `/stellar` namespace.

Conceptually:

```text
api(-testnet).multisig.tools/stellar/*
                     |
                     v
              Stellar API /*
```

The gateway removes only the protocol namespace. The Stellar service owns the complete API contract, including:

- operations discovery;
- OpenAPI;
- Request and Intent;
- Integration and Agent authority;
- Human authentication where applicable;
- PostgreSQL coordination;
- Blob private context;
- webhook/outbox/Queue/Cron;
- managed Classic execution;
- Stellar Horizon/RPC interaction.

The service is fixed to one Stellar network by deployment configuration.

It must never select `testnet` versus `public` from a caller-controlled path, body, query parameter, or wallet default.

## 4. Database boundary

Testnet and Mainnet do not share PostgreSQL authority.

Current target:

```text
Stellar Testnet API -> Neon PostgreSQL
Stellar Mainnet API -> independent PostgreSQL
```

Application code depends on PostgreSQL contracts and `DATABASE_URL`, not a provider-specific domain model.

Provider-specific recovery/backup controls remain operational concerns.

## 5. Documentation

### Public

```text
https://docs.multisig.tools/stellar
```

Public documentation is protocol-namespaced from the first release.

It uses a dedicated documentation application and deployment lifecycle.

Public documentation must not depend on Mainnet Human App availability.

### Internal

Target custom domain:

```text
https://internal.multisig.tools/stellar
```

The custom domain is not currently bound. Internal documentation is served from the private `multisig-tools-internal-docs` Vercel production deployment until that domain is explicitly configured.

Internal documentation is a separate private deployment.

It contains engineering architecture, runbooks, production readiness, security design, recovery procedures, and operational decisions.

Public and internal content are physically separated at build/deployment boundaries. Navigation hiding is not an access-control mechanism.

## 6. Repository target

Target deployable applications:

```text
apps/
  web/
  stellar-api/
  api-gateway/
  docs/
  internal-docs/
```

Shared, non-deployable protocol runtime:

```text
packages/
  stellar-core/
```

`packages/stellar-core` contains Stellar runtime modules that are consumed by both Human Web and the Stellar API. It contains no React or browser-only ownership and is not a Vercel project. This package exists because reuse is already proven in both deployables; do not create speculative cross-protocol packages before equivalent real reuse exists.

Shared packages are introduced only when code is actually consumed by more than one deployable.

A monorepo does not require every deployable to share one lockfile. The root npm workspace currently owns `apps/web`, `apps/stellar-api`, and `packages/stellar-core`; the self-contained Next.js apps keep their own install boundaries. Every Vercel project builds from its explicit app Root Directory.

## 7. Vercel project model

One Git repository may back multiple Vercel projects.

Target projects:

```text
apps/docs
  -> docs.multisig.tools

apps/internal-docs
  -> private Vercel production alias
  -> target: internal.multisig.tools

apps/api-gateway
  -> api-testnet.multisig.tools
  -> api.multisig.tools

apps/stellar-api
  -> Stellar Testnet API upstream
  -> Stellar Mainnet API upstream

apps/web
  -> stellar-testnet.multisig.tools
  -> stellar.multisig.tools
```

### Current Testnet mapping

As of 2026-09-22, Testnet is physically split as follows:

```text
stellar-testnet.multisig.tools
  -> Vercel project: multisig-tools-web-testnet
  -> Root Directory: apps/web
  -> same-origin /api/* rewrite
     -> https://api-testnet.multisig.tools/stellar/*

api-testnet.multisig.tools
  -> Vercel project: multisig-tools-api-gateway-testnet
  -> Root Directory: apps/api-gateway
  -> STELLAR_API_ORIGIN=https://multisig-tools-testnet.vercel.app/api

multisig-tools-testnet.vercel.app
  -> Vercel project: multisig-tools-testnet
  -> Root Directory: apps/stellar-api
  -> fixed Stellar Testnet backend
```

The Testnet Stellar API project retains the existing deployment identity and therefore retains its Sensitive environment variables, Neon resource `multisig-tools-testnet-pg`, Vercel Blob store `multisig-tools-testnet`, Queue, and Cron configuration. The temporary proof project used during extraction was removed after cutover.

The Human Web intentionally keeps browser calls on same-origin `/api/*`. Vercel rewrites those calls to the public Testnet Gateway. This preserves the existing HttpOnly `mst_auth` cookie and `SameSite=Lax` behavior while still forcing browser API traffic through the public Gateway.

Human authentication identity is deployment-bound, not backend-host-bound. Testnet challenges and session issuers remain tied to `stellar-testnet.multisig.tools` even when the request reaches the Stellar API through the Gateway or the backend's Vercel origin.

The external API contract is expressed relative to the protocol base (`/request`, `/intent`, `/operations`, and so on). Internal Vercel function paths under `/api/*` are implementation details and must not appear in public operation discovery or OpenAPI paths.

The same Gateway source is deployed twice with different `STELLAR_API_ORIGIN`.

The same Stellar API source is deployed twice with different fixed-network and infrastructure configuration.

The same Web source is deployed twice with different public API origin and environment identity.

## 8. Deployment gates

Public Docs may ship independently once its referenced public API paths exist.

Testnet Web/API may continue running for an extended validation period.

Mainnet code deployment, Mainnet capability enablement, and Mainnet Human launch are separate gates.

A deployed Mainnet API does not imply managed Classic is enabled.

A deployed Mainnet Web application does not imply Mainnet mutations are enabled.

## 9. Future protocols

A future protocol adds a sibling namespace and backend rather than expanding the Stellar backend into a multi-protocol service.

Example:

```text
api.multisig.tools/stellar
api.multisig.tools/ethereum

docs.multisig.tools/stellar
docs.multisig.tools/ethereum
```

At that point the repository may grow a sibling protocol backend such as `apps/ethereum-api`.

Until then, do not introduce abstractions for a protocol that does not exist.
