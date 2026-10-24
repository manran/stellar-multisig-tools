---
title: "MultiSig Tools Deployment Topology"
description: "Internal MultiSig Tools engineering documentation."
---

**Status:** Approved architecture
**Updated:** 2026-09-24

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
             Cloudflare path gateway
                     |
                     v
              Stellar API /stellar/*
```

Cloudflare owns the public protocol-path routing and preserves the `/stellar` namespace when forwarding through Tunnel. The self-hosted Node adapter dispatches that namespace into the existing Stellar route handlers. The root discovery surface and `/stellar/*` currently share one API container, but remain logically separate protocol surfaces so a future `/ripple/*` can be routed to a sibling runtime without turning the Stellar service into a multi-protocol backend.

The Stellar service owns the complete API contract, including:

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

Current topology:

```text
Stellar Testnet API -> self-hosted PostgreSQL 18.6
Stellar Mainnet API -> independent PostgreSQL (not yet provisioned)
```

Testnet coordination authority is now held in the Compose-managed PostgreSQL volume. Private API objects use a separate self-hosted filesystem volume rather than Vercel Blob. Testnet was pre-copied from the previous Neon authority and deliberately accepted as a new Testnet baseline without a final delta because historical Testnet continuity is non-critical.

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

`apps/web/src` is the sole Human Web source tree. `packages/stellar-core` contains Stellar runtime modules that are consumed by both Human Web and the Stellar API. It contains no React or browser-only ownership and is not a Vercel project. This package exists because reuse is already proven in both deployables; do not create speculative cross-protocol packages before equivalent real reuse exists.

Shared packages are introduced only when code is actually consumed by more than one deployable.

A monorepo does not require every deployable to share one lockfile. The root npm workspace currently owns `apps/web`, `apps/stellar-api`, and `packages/stellar-core`; the self-contained Next.js apps keep their own install boundaries. Every Vercel project builds from its explicit app Root Directory.

## 7. Deployment model

One Git repository backs multiple deployment targets, but Vercel is no longer the Testnet API runtime.

Current roles:

```text
apps/docs
  -> Vercel -> docs.multisig.tools

apps/internal-docs
  -> private Vercel production alias
  -> target: internal.multisig.tools

apps/web
  -> Vercel -> stellar-testnet.multisig.tools
  -> Vercel -> stellar.multisig.tools

apps/stellar-api
  -> self-hosted Testnet Compose runtime behind Cloudflare Tunnel
  -> isolated Mainnet Vercel skeleton remains prelaunch-only

apps/api-gateway
  -> no longer active in the Testnet request path
  -> retained only for the existing Mainnet prelaunch skeleton / historical topology until cleanup
```

### Current Testnet mapping

As of 2026-09-24, the active Testnet path is:

```text
stellar-testnet.multisig.tools
  -> Vercel project: multisig-tools-web-testnet
  -> Root Directory: apps/web
  -> same-origin /api/* rewrite
     -> https://api-testnet.multisig.tools/stellar/*

api-testnet.multisig.tools
  -> Cloudflare proxied DNS
  -> named Cloudflare Tunnel: mst-testnet-api
  -> Docker Compose edge network
  -> stellar-api:3000

stellar-api
  -> fixed Testnet Node HTTP adapter
  -> PostgreSQL 18.6 on private Docker data network
  -> filesystem private-object volume

webhook-worker
  -> PostgreSQL outbox authority
  -> Cloudflare Worker relay at api-testnet.multisig.tools/_relay*
  -> external Integration webhook receiver
```

Neither the Stellar API nor PostgreSQL publishes a host port. `cloudflared` is the only public API ingress path and establishes outbound Tunnel connections. PostgreSQL is attached only to the internal data network.

The Human Web intentionally keeps browser calls on same-origin `/api/*`. Vercel rewrites those calls to `https://api-testnet.multisig.tools/stellar/*`, preserving the existing HttpOnly `mst_auth` cookie and `SameSite=Lax` behavior while the API authority lives outside Vercel.

Cloudflare is the protocol namespace gateway. `/stellar/*` is routed through Tunnel to the Stellar runtime without stripping the namespace; `/_relay*` is intercepted by the webhook relay Worker. The root discovery surface and `/stellar/*` currently share the same API container, but their logical protocol boundary is preserved.

Testnet coordination data was pre-copied from the previous Neon PostgreSQL authority into the self-hosted PostgreSQL 18.6 volume and verified across all 20 base tables at the copy point. A final Neon delta was intentionally not imported because historical Testnet continuity is non-critical. Previous Vercel Blob private objects were not made a cutover dependency; new Testnet private objects are authoritative in the self-hosted filesystem volume.

Human authentication identity remains deployment-bound, not backend-host-bound. Testnet challenges and session issuers remain tied to `stellar-testnet.multisig.tools`.

The external API contract is expressed relative to the protocol base (`/request`, `/intent`, `/operations`, and so on). Internal transport/runtime paths remain implementation details and must not appear in public operation discovery or OpenAPI paths.

### Current Mainnet prelaunch skeleton

As of 2026-09-22, the current code baseline is also deployed in an isolated Mainnet skeleton without changing the public Mainnet domains:

```text
multisig-tools-web-mainnet
  -> Root Directory: apps/web
  -> fixed public
  -> same-origin /api/* rewrite
     -> https://multisig-tools-api-gateway-mainnet.vercel.app/stellar/*
  -> unique Vercel deployment is noindex
  -> NOT bound to stellar.multisig.tools

multisig-tools-api-gateway-mainnet.vercel.app
  -> Vercel project: multisig-tools-api-gateway-mainnet
  -> Root Directory: apps/api-gateway
  -> STELLAR_API_ORIGIN=https://multisig-tools-mainnet.vercel.app/api
  -> NOT bound to api.multisig.tools

multisig-tools-mainnet.vercel.app
  -> Vercel project: multisig-tools-mainnet
  -> Root Directory: apps/stellar-api
  -> fixed public
  -> MULTISIG_COORDINATION_WRITE_FREEZE=1
  -> MULTISIG_COORDINATION_STORAGE=blob
  -> MULTISIG_CLASSIC_MANAGED_EXECUTION_ENABLED=false
  -> private `multisig-tools-mainnet` Vercel Blob connected via OIDC only
  -> no Mainnet PostgreSQL, admin secret, webhook secret, Cron secret, or managed-channel master secret
```

The Mainnet backend and gateway stable `.vercel.app` aliases exist only to support the isolated internal chain. The three Mainnet projects are intentionally not Git-connected during this prelaunch stage. The backend's private Blob store is connected OIDC-only and its runtime read/write/delete path has been verified in an isolated Preview; coordination is still deliberately inert because writes are frozen and no Mainnet PostgreSQL authority exists. The skeleton remains deployment/network/storage-boundary proof, not production state authority.

Read-only/fail-closed validation completed on the isolated chain: fixed `public`, 36 public operations, no internal `/api/*` paths in discovery/OpenAPI, `classicManagedExecution.public=false`, Request creation rejected with `503 coordination_write_frozen`, and Testnet Integration self-service rejected with `409 testnet_integration_self_service_unavailable`.

`stellar.multisig.tools` still points to the legacy Mainnet deployment and `api.multisig.tools` is not DNS-bound. Neither public Mainnet surface was changed by the skeleton work.

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
