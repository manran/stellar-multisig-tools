# Vercel topology cleanup — 2026-11-01

This is a process record for the November 2026 MST deployment cleanup. It documents what was observed, what was changed, and which decisions remain open. It is not the long-term bootstrap authority.

## Why this cleanup happened

Recent product work landed faster than deployment topology maintenance. The Vercel team still contained active projects, historical stage projects, obsolete backend projects, old Mainnet deployments, and stale domain bindings. GitHub PRs therefore showed noisy Vercel statuses that did not match the real Testnet runtime.

The live runtime remains the source of truth.

## Verified Testnet runtime

The active Testnet backend is self-hosted on `wh` under the Compose project `mst-testnet-api`.

Active services:

- `stellar-api`
- `webhook-worker`
- PostgreSQL 18.6
- `cloudflared`

Neither the API container nor PostgreSQL publishes a host port.

The active public path is:

```text
stellar-testnet.multisig.tools
  -> Vercel Stellar Web
  -> same-origin /api/*
  -> api-testnet.multisig.tools/stellar/*
  -> Cloudflare
  -> named Tunnel: mst-testnet-api
  -> wh / stellar-api:3000
  -> PostgreSQL
```

`api-testnet.multisig.tools/_relay/*` is handled by the Cloudflare webhook relay path. The Vercel API Gateway is not part of the active Testnet request path.

## Vercel projects after cleanup

### Active

`multisig-tools-web-testnet`
- Testnet Human Web.
- `stellar-testnet.multisig.tools` is public and verified.
- Root Directory is `apps/stellar-web`.
- Vercel native Affected Projects is enabled.
- Old custom Ignored Build Step was removed.
- Production was rebuilt from current `main` and promoted.
- Custom-domain auto assignment is enabled.

`multisig-tools-directory`
- New directory/home candidate from `apps/directory`.
- No apex MST domain has been moved to it yet.
- Keep until the homepage migration decision is explicit.

`multisig-tools-docs`
- Active docs project.
- Root Directory is `apps/docs`.
- Vercel native Affected Projects is enabled.
- Old SHA-based Ignored Build Step was removed because shallow Git clones caused `fatal: bad object`.
- A clean production rebuild from current `main` succeeded.

`multisig-tools-internal-docs`
- Internal docs only.
- Root Directory is `apps/internal-docs`.
- Vercel native Affected Projects is enabled.
- Protected by Vercel SSO.

### Paused / candidate for deletion

`multisig-tools-api-gateway-testnet`
- Obsolete as a Testnet API gateway.
- The real public API path is Cloudflare -> Tunnel -> self-hosted `stellar-api`.
- Preview deployments are disabled.
- Git builds are ignored.
- Custom-domain auto assignment is disabled.
- All deployments are protected by Vercel SSO.
- Historical Vercel project-domain metadata may still list `api-testnet.multisig.tools`; live DNS/request traffic is Cloudflare, not Vercel.
- Candidate for deletion after rollback retention is no longer needed.

`multisig-tools-stellar-api-testnet-stage`
- Historical pre-cutover/stage backend.
- Preview deployments are disabled.
- Git builds are ignored.
- Custom-domain auto assignment is disabled.
- All deployments are protected by Vercel SSO.
- Candidate for deletion.

Historical `*-stage` Web projects were also disabled from normal PR deployment to stop obsolete BLOCKED statuses.

## Homepage status

The public homepage remains unchanged:

```text
multisig.tools
  -> redirect to www.multisig.tools

www.multisig.tools
  -> legacy Vercel project: multisig-tools
```

A newer `apps/directory` implementation exists in the Stellar MST repository, but the apex/homepage migration has not been decided.

Do not move `multisig.tools` or `www.multisig.tools` until that product decision is explicit.

## Mainnet status

Mainnet is not ready for public use.

The following projects were changed to paused/protected state:

- `multisig-tools-mainnet`
- `multisig-tools-api-gateway-mainnet`
- `multisig-tools-web-mainnet`
- `multisig-tools-mainnet-migration`

For these projects:

- Preview deployments are disabled.
- Git builds are ignored.
- Custom-domain auto assignment is disabled.
- All deployments are protected by Vercel SSO.

`stellar.multisig.tools` previously pointed to the old `multisig-tools` project on historical branch `feat/stellar-mvp`. It was reassigned to the Mainnet Web deployment, which is now protected by Vercel SSO. Anonymous requests now redirect to Vercel Authentication.

The old homepage project may still show stale project-domain metadata for `stellar.multisig.tools`. Runtime alias resolution now points to the protected Mainnet Web deployment. Remove the stale metadata when Vercel exposes a safe project-domain removal path or during final Mainnet cleanup.

## Vercel build cleanup

Five long-lived monorepo projects were normalized to explicit Root Directory settings and Vercel native Affected Projects behavior.

The previous custom SHA-based Ignored Build Step was removed from active projects. It was brittle because `VERCEL_GIT_PREVIOUS_SHA` may reference a commit absent from Vercel's shallow clone.

This was the source of:
- Docs production `fatal: bad object`.
- Misleading `BLOCKED` deployment states on projects whose directory did not change.

Historical red Vercel statuses already attached to old PR commits were not rewritten. They are historical records, not evidence of current CI failure.

## External verification after cleanup

Verified anonymously from outside the Vercel runtime:

- `https://stellar-testnet.multisig.tools` -> HTTP 200.
- `https://api-testnet.multisig.tools/stellar/runtime-config` -> HTTP 200 via Cloudflare.
- `https://www.multisig.tools` -> HTTP 200.
- `https://stellar.multisig.tools` -> HTTP 302 to Vercel Authentication.
- Mainnet Vercel Web -> HTTP 302 to Vercel Authentication.
- Mainnet Vercel Gateway -> HTTP 302 to Vercel Authentication.
- Old Testnet Vercel backend endpoint is no longer a usable public backend.

## Remaining decisions

1. Decide whether `multisig.tools` / `www.multisig.tools` should move from the legacy homepage project to `apps/directory`.
2. Delete obsolete Testnet Vercel backend/gateway/stage projects after rollback retention is no longer useful.
3. Delete or clean stale Vercel project-domain metadata for `api-testnet.multisig.tools` and `stellar.multisig.tools` once it can be done without changing live DNS unexpectedly.
4. Keep Mainnet protected until Testnet product work and Mainnet readiness are explicitly approved.
5. After deployment topology is stable, merge the current productization PR stack, then continue DocuSign-inspired product work.

## Rule for future work

Before treating a Vercel project or domain entry as active infrastructure, verify:

1. live DNS / alias resolution;
2. current runtime path;
3. Vercel project settings;
4. self-hosted Compose state when relevant.

Vercel project metadata alone is not sufficient evidence that a request actually traverses Vercel.
