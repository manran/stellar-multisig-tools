# MultiSigTools

MultiSigTools is a Stellar shared-authorization operation base. Humans use `stellar.multisig.tools`; Agents, bots, scripts, wallets, and clients such as Fresnica CLI use the same composable operation core without gaining Stellar signing custody or creating a second transaction lifecycle.

## Current product model

- **Sign** — Inbox is the workspace home, with `New / Inbox / Activity / Address Book` for Human transaction work.
- **Manage** — Treasury is the workspace home, with `New / Treasury` for shared-account policy and Treasury operations.
- **Contracts** — `/contracts` is the signer-owned workspace for saved Soroban contracts; saving a contract records work context, not authority.
- **Signing Request** — the shared coordination object and `/api/request` resource used by Human and Agent clients.
- **Signer Agent access** — one Stellar signer Principal (`network + G-address`) may delegate named `msa_...` credentials with cumulative `Read / Write / Sign` authority. The credential is an API actor, not a Stellar signer or private key.
- **Treasury Box** — shared MultiSigTools metadata and administration audit around a classic Stellar `G...` Treasury account. Treasury Settings may issue an observer-only `mta_...` Audit credential for that Treasury's Activity; ordinary machine transaction authority is signer-owned, not Treasury-owned.

There is no separate `/api/automation` product endpoint. Agent Request create/read/contribute operations use the same Request handlers and validation core as the Human product. Final Stellar submission remains a separate Human action in Agent API v1.

The service is non-custodial. It never asks for or stores Stellar seed phrases or private signing keys.

## Documentation and machine discovery

- **Public Docs:** `https://stellar.multisig.tools/docs`
- **OpenAPI 3.1:** `https://stellar.multisig.tools/openapi.json`
- **Operation catalog:** `https://stellar.multisig.tools/api/operations`
- The deployment root advertises OpenAPI with the standard HTTP/HTML `service-desc` link relation and developer documentation with `service-doc`.
- [`DOCS_INFORMATION_ARCHITECTURE.md`](DOCS_INFORMATION_ARCHITECTURE.md) — public Docs routes, information architecture, vocabulary, progressive-disclosure, and growth contract.
- [`UX_LANGUAGE_AND_DISCOVERY.md`](UX_LANGUAGE_AND_DISCOVERY.md) — current workspace navigation, language hierarchy, and Inbox discovery contract.
- [`PRODUCT.md`](PRODUCT.md) — broader historical Human product contract; the UX document supersedes older naming/navigation wording where they conflict.
- [`BRAND.md`](BRAND.md) — product-name, mark semantics, descriptor discussion, and the professionally bounded 虎符 / tiger-tally historical analogy.
- [`apps/internal-docs/content/stellar/development/soroban-authorization.md`](apps/internal-docs/content/stellar/development/soroban-authorization.md) — current Intent-first Soroban AUTH, configured C-account adapter, and late Execution boundary.
- [`AGENT_API.md`](AGENT_API.md) — current signer-owned machine integration contract and examples.
- [`apps/internal-docs/content/stellar/architecture/operation-architecture.md`](apps/internal-docs/content/stellar/architecture/operation-architecture.md) — operation-first product rule and composition contract for every consumer.
- [`CONTRACT_WORKSPACE.md`](CONTRACT_WORKSPACE.md) — Contract workspace, discovery, and authority boundaries.
- [`TRANSACTION_CONTEXT.md`](TRANSACTION_CONTEXT.md) — Stellar Memo / Private Note / Private Commitment model.
- [`PRIVACY.md`](PRIVACY.md) — beta privacy notice.
- [`TERMS.md`](TERMS.md) — beta terms of service.

## Language boundary

The Human UI leads with task language: Inbox, signatures, payments and account-control changes. Treasury administration adds Stellar signing-policy terms where they are useful. Agent/developer documentation uses exact protocol terms such as XDR, Principal, Actor, API credential, idempotency and HTTP status. Raw protocol detail remains available without making it the primary vocabulary for ordinary signers.

## Inbox discovery

Inbox discovery is signer-oriented. New Requests are indexed by their source accounts and any direct `G...` extra signer. When an Inbox opens, MultiSigTools first narrows to matching Request candidates for the current signer and then performs the existing live signer-policy authorization check before returning private data. The index is discovery only and is never authorization evidence.

Existing Request records are migrated to the discovery index on first use. If discovery/index access is temporarily unavailable, Inbox can fall back to the legacy full scan rather than changing the authorization rule.

## Security boundaries

- Signing occurs in an external wallet, hardware signer, CLI, HSM/KMS or other compatible signer.
- Shared Requests accept signatures only for the exact transaction being coordinated.
- Sensitive Human and Agent actions refresh relevant Stellar signer/account state.
- Mainnet submission remains an explicit action; `Sign != Submit` and `Ready != Submitted`.
- Request capabilities stay in URL fragments and are not ordinary path/query credentials.
- Accepted Request, signature, submission, participant, and Activity records are durable evidence. Request expiry closes collaboration; it does not trigger scheduled physical deletion.
- Signer Agent secrets (`msa_...`) and Treasury Audit secrets (`mta_...`) are displayed only once; server storage keeps verifier hashes plus non-secret metadata.
- Agent `POST /api/request` and semantic `POST /api/intent` require an `Idempotency-Key`; the credential Principal/network and current signer access are independently validated. Soroban Intent AUTH is detached from the final transaction source.
- A Sign Agent carries no Stellar private key. Signed XDR/signature contributions are cryptographically verified and may only add authorization attributable to that Principal.
- Treasury Audit credentials are observer-only and cannot create Requests, contribute signatures, submit transactions, or administer the Treasury.
- Private Note is server-private, not E2EE, and its plaintext is excluded from Treasury audit events.
- Application audit is append-only evidence; it is not represented as regulatory WORM/tamper-proof storage.

## Advanced cold-account bootstrap

The footer exposes **Advanced: bootstrap treasury**. A cold issuer/master account never connects to the site. MultiSigTools loads only its public `G...` address, builds the account-control XDR through the normal Designer, and uses Signing Room's existing signed-XDR merge path so the transaction can be signed offline before final Review/Submit.

## Development

Requires Node.js 24.x.

```bash
npm ci --no-audit --no-fund
npm test
npm run build
npm run dev
```

The production build runs Stellar/frontend and API/server TypeScript gates before Vite.

## Deployment

Mainnet and Testnet are separate products at the deployment boundary: `stellar.multisig.tools` sets `VITE_STELLAR_DEPLOYMENT_NETWORK=public`; `stellar-testnet.multisig.tools` sets `VITE_STELLAR_DEPLOYMENT_NETWORK=testnet`. Production must never use `dual`, which exists only for local compatibility. `GET /api/runtime-config` exposes the effective policy to every client, and mismatched API inputs fail with `deployment_network_mismatch`.

Each deployment uses its own private Vercel Blob store and authentication cookies. Vercel deployments use the linked store/OIDC; local development may use `BLOB_READ_WRITE_TOKEN`.

Accepted Request data is not subject to scheduled cleanup. Human Request creation requires an unlocked Stellar signer session and current signer access to the transaction; Agent creation requires a signer-owned credential and the same live signer check. Request bodies, XDR, and Private Note remain byte-limited before acceptance.

Production must also apply edge/WAF abuse controls to write-heavy or upstream-consuming endpoints, especially `/api/request`, `/api/intent`, `/api/contract-call`, `/api/contract-prepare`, `/api/contract-interface`, `/api/auth`, and credential management. Authentication and payload limits reduce anonymous storage abuse but are not substitutes for rate limiting, anomaly controls, or infrastructure quotas. Do not rely on process-local in-memory rate limiting as a serverless abuse-control boundary.

Do not commit Blob tokens, Agent/Audit credential secrets, Request capabilities or signer secrets.
