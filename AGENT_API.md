# MultiSigTools Agent API v1

**Status:** beta integration contract  
**Base origin:** `https://stellar.multisig.tools`  
**Web quick start:** `https://stellar.multisig.tools/developers`

MultiSigTools exposes one signer-oriented API shared by a Human and the Agents they explicitly delegate. A Treasury is a resource the signer may access; it is not the normal machine principal.

```text
Principal = Stellar signer identity (network + G-address)
Actor     = Human session or one named Agent credential
Credential != Stellar private key != Stellar signature
```

Two Agent credentials may represent the same Principal while remaining independently named, scoped, audited and revocable.

External `msi_...` Service integrations are intentionally **not** Signer Agents. A Service workload is not bound to one signer Principal; it receives explicit Classic source-account / Soroban contract scope and must still collect the real chain authorization. See `PLATFORM_EXTENSION_POINTS.md` and `OPERATION_ARCHITECTURE.md`.

## Agent access levels

A Human connects the signer wallet, opens **Agent access**, unlocks private MultiSigTools data, names the Agent, and chooses one cumulative level:

| Level | Authority |
| --- | --- |
| **Read** | Read the Principal's Inbox, Activity, Request details/status, saved contracts, personal contacts, and accessible Treasury metadata/names. |
| **Write** | Includes Read. Create Signing Requests and shared Soroban authorization preparations, refresh/freeze preparation, keep/forget contracts, create/update personal contacts, and perform non-cryptographic Request collaboration actions such as decline. |
| **Sign** | Includes Write. Submit signed XDR and contribute valid Stellar transaction or detached Soroban authorization signatures attributable to this Principal. |

The complete `msa_...` credential secret is shown once. MultiSigTools stores only a verifier hash plus non-secret metadata.

A Sign credential contains no Stellar secret key. It authorizes API operations carrying cryptographic authorization; MultiSigTools independently verifies every newly contributed signature.

## One Request API

Human and Agent clients use the same Request resource:

```text
POST  /api/request   create
GET   /api/request   read
PATCH /api/request   decline or contribute signature
PUT   /api/request   final Stellar submission (Human only in v1)
```

There is no separate `/api/automation` product endpoint.

Agent authentication:

```text
Authorization: Bearer <msa_... Agent credential>
```

Existing Human private-session/capability authentication continues on the same Request handlers.

## Create a Request

```text
POST /api/request
Authorization: Bearer <Agent credential>
Content-Type: application/json
Idempotency-Key: <stable business identifier>
```

```json
{
  "network": "public",
  "xdr": "AAAA...",
  "externalReference": "invoice-42",
  "privateNote": "Vendor payment requested by Finance."
}
```

Rules:

- **Write** may create a Request from unsigned XDR.
- XDR that already contains Stellar signatures requires **Sign**.
- credential network must match the transaction network;
- the Principal must currently be an authorized signer for the transaction;
- MultiSigTools reuses the same XDR/signature/precondition/Request validation core as Human flows;
- Agent Private Commitment creation is not supported in v1;
- Agent-created Requests do not mint a share capability by default;
- the Principal is persisted as a Request participant and the named Agent is persisted as actor provenance.

The Agent credential is not bound to one Treasury. One signer may participate in multiple Treasuries or a multi-party transaction. Each transaction is authorized against fresh Stellar signer state.

Response uses the normal Request projection plus Agent retry metadata:

```json
{
  "request": {
    "id": "0123456789ABCDEF",
    "status": "awaiting_signatures",
    "statusReason": "signatures_required",
    "statusDetail": "Waiting for additional valid signatures.",
    "signatureCount": 0,
    "transactionHash": "..."
  },
  "replayed": false,
  "externalReference": "invoice-42",
  "access": {
    "shareable": false,
    "activityBound": true
  }
}
```

## Idempotency

Agent `POST /api/request` requires `Idempotency-Key`.

```text
Agent credential + Idempotency-Key -> exactly one Signing Request
```

Retry the same business action with the same key. Reusing the same key with a different proposal returns `409 idempotency_conflict`.

The idempotency claim reserves one Request id before the durable Request write. Once the Request store call begins, later failures do not release the claim merely because participant projection, credential usage, or response delivery failed. Retry reuses the reserved Request id.

Only a failure before the Request store call begins may release a newly-created claim.

This is the v131 financial no-duplicate invariant carried into the signer-owned Agent API without a second Agent Request mapping subsystem.

## Read one Request

```text
GET /api/request
Authorization: Bearer <Agent credential>
x-multisig-request-id: 0123456789ABCDEF
```

Read requires **Read** and current Principal access to that transaction.

Clients branch on typed `statusReason`, not Human-facing `statusDetail`.

Current reason vocabulary includes:

- `signatures_required`
- `preconditions_not_met`
- `preconditions_unavailable`
- `authorization_complete`
- `ledger_confirmed`
- `request_expired`
- `transaction_expired`
- `sequence_stale`
- `stored_signature_unrecognized`
- `extra_signature_invalid`
- `preconditions_failed`

Unknown future values require a fresh read or Human review rather than parsing English text.

## Decline

```text
PATCH /api/request
Authorization: Bearer <Write-or-Sign Agent credential>
x-multisig-request-id: 0123456789ABCDEF
Content-Type: application/json

{
  "decision": "decline"
}
```

Decline is non-cryptographic collaboration state. It requires **Write**, does not add Stellar signing weight, and does not cancel the transaction for other signers.

## Contribute a signature

```text
PATCH /api/request
Authorization: Bearer <Sign Agent credential>
x-multisig-request-id: 0123456789ABCDEF
Content-Type: application/json

{
  "signedXdr": "AAAA..."
}
```

The newly-added valid signature must be attributable to the credential Principal. An Agent representing signer A cannot use its credential to contribute signer B's newly-added signature.

Activity preserves two independent facts when available:

```text
actorAddress = cryptographic Stellar signer G...
actor        = delegated Agent credential that submitted the contribution
```

If an Agent uploads already-signed XDR, MultiSigTools can prove which signer signed and which Agent credential submitted it. It does not claim the Agent generated that signature. Stronger provenance requires a future controlled signer/HSM invocation path.

Agent contributions do not mint browser Contribution Grants.

## Final Stellar submission

Agent credentials cannot `PUT /api/request` in v1.

`Sign` means **contribute Stellar authorization as the Principal**, not "execute everything". Final network submission remains a separate Human action. Agent submission attempts receive `agent_submit_denied`.

A future execution permission should be introduced only for a concrete policy-controlled use case; it must never be implied by Sign accidentally.

## Headless Contract operations

Machine discovery, the operation catalog, and deployment network policy are public:

```text
HEAD /                         # Link: rel="service-desc" and rel="service-doc"
GET  /openapi.json             # OpenAPI 3.1 transport contract
GET  /api/operations           # stable business-operation catalog
GET  /api/runtime-config       # deployment-owned network
GET  /developers               # Human-readable integration and authority model
```

The root HTML repeats the same `service-desc` and `service-doc` links for DOM-only clients. Every catalog operation points to its OpenAPI path and method.

A production domain owns exactly one Stellar network. Clients should discover it once and send only matching operation input; a cross-deployment request fails with HTTP 409 and `deployment_network_mismatch`.

Classic business Prepare is explicit rather than inferred from destination state:

```text
POST /api/payment-prepare         # Payment/batch; destination accounts must already be active
POST /api/account-create-prepare  # CreateAccount; destination must still be inactive
```

Both operations accept Human sessions, signer-Agent credentials, or scoped Integration credentials and return exact unsigned XDR after fresh Stellar validation. They share the same source-account authorization checks used by the Request lifecycle. Payment and CreateAccount never auto-convert into each other. A Human composer may switch between the two while preserving compatible form fields; an Agent or Service chooses the operation explicitly. Both support either a text memo or a 32-byte `memoHashHex`, never both.

The canonical Soroban Agent workflow is Intent-first:

```text
GET   /api/contract-interface  # public interface discovery
POST  /api/intent              # Write + Idempotency-Key; semantic contract Intent
GET   /api/intent              # Read + X-MultiSig-Intent-Id
PATCH /api/intent              # Sign; contribute detached Soroban AUTH
PUT   /api/intent              # Write; prepare execution, reconcile prepared hash, or replan
```

Example semantic creation:

```json
{
  "network": "testnet",
  "contractId": "C...",
  "method": "transfer",
  "arguments": {
    "from": "G...",
    "to": "G...",
    "amount": "10000000"
  },
  "privateNote": "optional private workflow context"
}
```

GET inspection returns the current Intent/authorization state plus a persisted evidence timeline for creation provenance, accepted AUTH contributions, AuthorizationPlan revisions, execution preparations, and independently observed Stellar results. The timeline contains contribution digests and signer/Agent provenance where recorded, but not raw signature/XDR payloads. `execution_confirmed` or `execution_failed` appears only after MultiSigTools reconciles a persisted preparation hash against Horizon; it never attributes an external submitter that MultiSigTools did not observe.

Creation stores no transaction sequence, fee, lifetime, or envelope. Recording simulation discovers an immutable detached AuthorizationPlan. Each PATCH contribution is cryptographically verified against the Agent Principal and current live signer policy. When authorization becomes `authorization_ready`, PUT loads a fresh sequence, materializes the transaction, and runs enforcing simulation before returning the final unsigned execution package. For an externally submitted prepared transaction, call PUT again with `{"action":"reconcile_execution","transactionHash":"..."}`. The hash must already exist in durable preparation evidence; a Horizon 404 returns `observed=false` and writes no result fact.

`SOURCE_ACCOUNT` authorization is rejected with `source_account_auth_unsupported`: it would bind Soroban authorization to the transaction source and defeat source-late execution. Contracts/integrations used with Intent coordination must expose detached address authorization.


### Integration Service provisioning

Integration Service credentials are operator-provisioned, not self-service. The controlled runtime surface is `/admin/integrations`; it is intentionally absent from ordinary product navigation and requires a separate deployment operator secret (`mia_...`). Generate that secret once with `npm run integration:admin-secret` and configure only its SHA-256 verifier as `MULTISIG_INTEGRATION_ADMIN_SECRET_HASH`. The plaintext operator secret is never stored by the application.

The admin surface creates or rotates `msi_...` credentials, enables/disables a Service, and edits network, Classic-account, Soroban contract/method, executor allowlist, and default-executor scope. A new or rotated `msi_...` value is returned once; durable storage retains only its verifier hash. `MULTISIG_INTEGRATION_CREDENTIALS_JSON` remains a bootstrap source. A durable record with the same `serviceId` overrides bootstrap configuration, including an explicit disabled state. Configuring `MULTISIG_INTEGRATION_ADMIN_SECRET_HASH` enables the durable registry contract for that deployment; from that point, durable credential storage must be readable and Service authentication fails closed rather than reviving bootstrap credentials. Deployments that have not enabled Integration administration keep the legacy env-only bootstrap path.

Deployment-owned planning sources and MultiSigTools managed executors remain outside Service administration. They are infrastructure configuration, not Service-grantable authority.

### Integration Service executor shortcut

An Integration Service may tell MultiSig Tools its executor before AUTH collection, without constructing the final transaction early. Executor resolution is deterministic:

```text
Intent executor override
  > Service default executor snapshotted when the Intent is created
  > unresolved until execution preparation
```

The Service credential may configure `sorobanDefaultExecutor`; it must also appear in that credential's `sorobanExecutionAccounts` allowlist. An Intent-level `executor` overrides the Service default and must be in the same allowlist. If neither exists, MultiSig Tools uses its deployment planning source only for recording simulation; that planning source is never promoted into durable execution policy.

Example Integration creation with an Intent-specific executor:

```json
{
  "network": "testnet",
  "contractId": "C...",
  "method": "reserve",
  "arguments": {"wallet":"G..."},
  "executor": "G...EXECUTOR"
}
```

A Service default is snapshotted into the Intent. Changing the credential configuration later does not change an existing Intent or an idempotent replay.

After detached AUTH becomes `authorization_ready`, request the exact execution package:

```json
{"action":"prepare_execution"}
```

If the Intent still has no executor, the Service may bind one at this point:

```json
{"action":"prepare_execution","executor":"G...EXECUTOR"}
```

If the Service supplies no executor and deployment-managed execution is configured, MultiSig Tools binds that managed executor and takes the managed execution route. The recording/planning account is never used as this fallback. Once an executor is bound, later preparation must reuse it; attempting to replace it returns `intent_executor_locked`. `multisigtools_managed` is an execution-routing commitment, not signer authority or submission evidence: the managed executor account identity is deployment-owned, while signing/submission for that account belongs to the deployment's managed execution layer. Neither the planning source nor the Integration credential is promoted into that signing authority.

If a prepared transaction was lost, became stale, or failed to submit for an unknown reason, ask MultiSig Tools to materialize a fresh package from the same Intent and bound executor:

```json
{"action":"refresh_execution"}
```

`refresh_execution` does not change the Intent, AuthorizationPlan, AUTH, or executor. It reloads fresh source state, rebuilds the transaction shell, runs enforcing simulation again, compares effects again, and persists a new `execution_prepared` fact. If AUTH/effects are no longer reusable, the normal typed reauthorization/replan error is returned instead of silently weakening checks.

The execution response is a complete JSON package, not a bare XDR. It includes at least `intentId`, `network`, `intentDigest`, `authorizationPlanDigest`, `authorizationPlanRevision`, executor/source information, sequence, transaction hash, validity, latest ledger, effects/effects diff, `preparedAt`, and unsigned `xdr`. MultiSig Tools durably retains the preparation evidence needed for audit/reconciliation; returning XDR is not itself evidence of handoff, submission, or confirmation.

`executionSource` remains accepted as a deprecated alias for `executor` on PUT for compatibility. New Service integrations should use `executor`.

For diagnostics and advanced tooling, `POST /api/contract-call` and `POST /api/contract-prepare` remain public low-level transaction construction / recording-simulation primitives. They do not replace the Intent coordination model. Human Import XDR may convert an unsigned, prepared single InvokeHostFunction transaction into an Intent; Agent clients should create semantic Intents directly.

Fresnica CLI, scripts, bots, Agents, and the Web UI are peer consumers of these operations. They must not reproduce a UI click sequence or invent a Contract-only Request lifecycle. Clients branch on typed error `code` values.

`GET /api/activity?view=work` is an additive personal-history projection for Human or signer-Agent callers. It returns one cursor-ordered `workItems[]` stream with `kind=request` or `kind=soroban_intent`; the default `/api/activity` response remains transaction-only for compatibility, and Treasury Activity keeps its existing source-account scope. Soroban Intent history is visible only when the Principal created the Intent or actually contributed detached AUTH; discovery-index membership alone never grants history access.

## Signer workspace endpoints

Use the same Bearer credential across the Principal's workspace:

```text
GET /api/treasuries
GET /api/address-book
PUT /api/address-book       # Write or Sign
DELETE /api/address-book    # Write or Sign
GET /api/contracts
PUT /api/contracts          # Write or Sign
DELETE /api/contracts       # Write or Sign
GET /api/inbox
GET /api/activity
GET /api/activity?view=work  # opt-in unified Request + Soroban Intent history for this signer Principal
GET/PATCH/POST /api/request
```

### Inbox

Inbox is signer-owned:

```text
Principal signer
  -> Inbox
  -> Requests that currently need this signer
```

It does not belong to a Treasury or to the Agent itself.

### Saved contracts

`/api/contracts` exposes the Principal's private Contract workspace references. Read lists; Write/Sign may keep or forget a C-address. The optional request network must match the credential Principal.

```json
{ "network": "testnet", "contractId": "C..." }
```

Saving a contract records work context only. It does not grant contract authority, Stellar signer access, or submission permission.

### Contacts and Treasury names

`/api/address-book` exposes the Principal's private personal aliases. Read lists; Write/Sign may create, update and delete.

`/api/treasuries` discovers accounts the Principal currently controls and returns shared Treasury metadata, including shared names. Live Stellar signer state remains authorization truth.

A future shared company/Box Contacts directory is a separate resource. One signer's personal Address Book must never be automatically promoted into shared company data.

### Activity and private context

Read authority follows the Principal but does not flatten narrower privacy boundaries. Current Treasury signer status does not automatically reveal participant-only Private Note context.

## Treasury Audit access

Treasury Settings no longer exposes ordinary transaction-capable API credentials.

It may create a fixed-scope **Treasury Audit credential** (`mta_...`). This credential is resource-owned and observer-only.

Allowed:

- read Activity for that one Treasury.

Not allowed:

- Inbox;
- personal Address Book;
- full shared Contacts directory;
- create a Request;
- decline a Request;
- contribute a signature;
- submit a transaction;
- rename/manage the Treasury;
- manage credentials through the machine endpoint;
- receive participant-only Private Note context merely because it audits the Treasury.

The Treasury Audit credential is an observer, not a transaction Actor.

## MCP, Skills and Agent adapters

The HTTP API is the canonical machine contract. MCP servers, Skills and SDK helpers should be thin adapters rather than owners of Stellar transaction semantics or Request lifecycle.

```text
Human instruction
  -> Agent / optional Skill
  -> optional MCP/tool adapter
  -> Signer Agent API
  -> Request validation / coordination
  -> Stellar network truth
```

An Agent may build XDR itself with the Stellar SDK. MultiSigTools owns delegated access, private semantic resolution, exact transaction validation, signature coordination and retained evidence.

Never place `msa_...` or `mta_...` secrets in model-visible prompts, Skill text, URLs, source repositories, Private Notes or logs.

## Client security requirements

- Create one named credential per Agent actor.
- Use the lowest sufficient level: Read, Write or Sign.
- Treat Sign as high privilege even though it contains no Stellar private key.
- Keep Stellar private keys in wallets, secure signers, HSM/MPC systems or other dedicated custody boundaries.
- Revoke exposed Agent/Audit credentials immediately.
- Use stable idempotency keys for financial Request creation.
- Re-read Request/ledger state before changing upstream accounting state.
- Do not treat `ready` as `submitted`.
- Apply production edge/WAF abuse controls before broad public machine exposure.
