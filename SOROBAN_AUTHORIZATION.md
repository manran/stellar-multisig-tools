# MultiSig Tools — Soroban Authorization Architecture

Status: Historical S1-S3 checkpoints; current architecture is Intent-first
Date: 2026-09-08; superseded lifecycle: 2026-09-14

## Current architecture — Intent-first

The active G-account coordination model is now:

```text
semantic Soroban Intent
  -> recording simulation / immutable detached AuthorizationPlan
  -> append-only detached AUTH contributions
  -> authorization_ready
  -> late-bound Execution source + fresh sequence
  -> enforcing simulation / final unsigned transaction
  -> ordinary Proposal only when envelope multisig is needed
```

The durable Intent stores no transaction source, sequence, fee, timebounds, resources, or envelope signatures. `SOURCE_ACCOUNT` authorization is rejected with `source_account_auth_unsupported` because it binds Soroban authority to the final transaction source and defeats source-late execution. Supported imported prepared XDR is converted into this same Intent model: valid detached AUTH evidence is retained, while the imported transaction shell is discarded.

Sections S1-S3 below are retained as protocol research/history. Where they describe Review-owned G-account AUTH, a prepared-XDR freeze lifecycle, or SOURCE_ACCOUNT as an accepted collaboration mode, those lifecycle statements are superseded by this section and `OPERATION_ARCHITECTURE.md`. Contract-account adapter evidence remains relevant because custom `__check_auth` credentials are contract/network-enforced rather than ordinary G-account detached AUTH.

This document defines how Soroban enters the existing MultiSig Tools transaction workflow. It does **not** create a separate Soroban workspace, lifecycle, or Request type.

## 1. One Human workflow

Soroban keeps the same Human journey:

```text
Prepare -> Review -> Sign -> Submit -> Done
```

`Done` remains the terminal workflow stage. `Transaction Receipt` and `Activity` remain history/evidence resources of Done; Receipt is not a sixth step and does not replace Done.

The difference is authorization ownership, not workflow vocabulary.

## 2. Two authorization domains

A transaction containing `InvokeHostFunction` may require two different kinds of authorization evidence:

```text
Stellar transaction
  |
  +-- transaction-envelope authorization
  |     source-account thresholds
  |     extra signers
  |     fee-bump inner/outer signatures
  |
  +-- Soroban authorization entries
        authorizing address / source-account credentials
        authorized invocation tree
        expiration / nonce
        entry-specific signature payloads
```

These facts must never be flattened into one global signature count.

A source-account Soroban credential carries no auth-entry signature of its own; its authority is supplied through the transaction envelope. Address credentials are separate authorization objects and may use Stellar-account Ed25519 signatures or custom account-contract signature payloads.

## 3. Freeze invariant

The current Proposal / Signing Request contract freezes one exact Stellar transaction XDR and then merges decorated transaction-envelope signatures without changing the transaction body.

Soroban address authorization does not obey that merge rule:

- auth-entry signatures change the transaction body;
- changing the body changes the transaction hash;
- envelope signatures therefore cannot be safely collected against an earlier body;
- envelope signatures are collected only after Soroban authorization entries are finalized.

Therefore an auth-entry signature must **not** be treated as another decorated transaction signature and must **not** be appended through the current `Add signed XDR` / envelope-signature merge path without a dedicated ownership model.

S2 implements this constraint by keeping all Soroban body mutation inside Review, before the durable Proposal exists.

## 4. S1A — shipped local Import/Review foundation

The first shipped Soroban slice established a read-only protocol-inspection foundation.

For imported `InvokeHostFunction` XDR, Review may locally show:

- host-function type;
- contract C-address and function name for contract calls;
- bounded argument previews decoded with the pinned Stellar SDK;
- embedded `SorobanAuthorizationEntry` credential type and authorizer;
- signature-bearing credential nodes and whether they contain evidence;
- signature expiration ledger where present;
- the authorized invocation tree, including sub-invocations.

Protocol decoding uses the pinned `@stellar/stellar-sdk` helpers (`inspectAuthEntry`, `buildInvocationTree`, `scValToNative`) rather than hand-maintaining credential-arm logic. This preserves support for current address credential forms such as `addressV2` and delegated authorization.

S1A itself does not call Stellar RPC automatically. At that milestone it also did not sign/mutate auth entries or cross Review -> Sign. Those restrictions were the deliberate predecessor to the S2 freeze model below. Guided contract-call composition and contract-specific business-meaning inference remain out of scope.

## 5. S1B — configurable RPC simulation

`simulateTransaction` enriches Review with execution facts that cannot be derived safely from static XDR alone, including resource fee guidance, return value, state-change/event counts, and authorization recorded during execution. Simulation never signs, but a successful result may be assembled into the execution-ready transaction body used by S2. Imported XDR keeps simulation explicit; a guided Contract Call created inside MultiSigTools runs the same recording simulation automatically when it reaches Review because that transaction cannot cross into Sign until its execution resources and authorization requirements are known.

Project configuration owns the endpoint:

```text
STELLAR_RPC_PUBLIC_URL   default https://rpc.lightsail.network/
STELLAR_RPC_TESTNET_URL  default https://soroban-testnet.stellar.org/
```

The defaults are ordinary public configuration, not credentials. Deployments may replace either endpoint without changing Soroban parser or Review ownership.

Human/network rules:

- **Imported XDR keeps simulation explicit.** Review does not send an externally composed Soroban transaction to the configured RPC provider until the Human chooses the check.
- **Guided Contract Call Review runs recording simulation automatically.** Entering Review from MultiSigTools' own Contract Call composer is the Human action that triggers the check; Review discloses that the exact pre-submission XDR is sent to the configured RPC provider.
- Re-running a completed or failed check remains an explicit Human action.
- Simulation uses `authMode=record` so Review can discover authorization requested by execution without pretending the returned entries are already satisfied.
- RPC/provider failure is **simulation unavailable**, not evidence that the transaction is invalid. A simulation `result.error` is a distinct execution error.
- Results are bound to the exact reviewed XDR, network, and resulting transaction hash; changing the XDR/network clears the previous simulation result.
- Simulation output is execution/review evidence only. It is not an authorization signature. S2 uses its execution inputs to assemble the candidate transaction, then independently verifies required authorization before the Sign gate.
- The current RPC API accepts one non-fee-bump transaction containing exactly one `InvokeHostFunction`; other Soroban XDR remains locally inspectable but the simulation action is disabled rather than reshaping the transaction.

Simulation-provider facts remain Review-only. The durable Proposal stores the final frozen Stellar XDR and its protocol evidence, not a provider-specific simulation transcript.

## 6. S2 — G-account authorization preparation and freeze

S2 keeps body mutation in Review and admits only a verified final transaction into the existing Proposal.

The sequence is:

```text
recording simulation (automatic for guided Contract Call; explicit for imported XDR)
  -> assemble SorobanTransactionData + recorded auth
  -> collect detached G-account auth-entry signatures
  -> verify live G-account medium thresholds
  -> freeze exact final XDR / transaction hash
  -> existing Proposal collects envelope signatures
```

Rules:

1. `SOURCE_ACCOUNT` Soroban credentials need no detached auth-entry signature; the relevant account authorization is enforced by the final transaction envelope.
2. This milestone supports ordinary G-account `ADDRESS` / `ADDRESS_V2` authorization using standard Ed25519 signature vectors.
3. The current simulation result owns the new authorization topology. Assembly clears draft auth entries before applying the recorded simulation auth, so pre-existing partial auth cannot hide newly discovered authorizers; any detached authorization is collected again against this preparation. A real unsigned G-account credential recorded by SDF RPC may carry `signature = scvVoid`; for a non-delegated unsigned G address S2 treats that as an uninitialized standard Ed25519 signature vector, while a signed credential with the same undecodable shape still fails closed.
4. Re-simulation replaces, rather than stacks, an older Soroban resource fee: the clean assembly base removes the embedded prior resource fee from `transaction.fee` before adding the current simulation minimum resource fee. Imported preconditions are preserved byte-for-byte at the XDR level; in particular Stellar CLI `--build-only` transactions with `precondNone` remain `precondNone` after Soroban assembly instead of gaining an implicit timeout.
5. A detached G-account can be multisig. MultiSig Tools verifies every auth-entry signature against the exact CAP-71 preimage, refreshes the account's current Horizon signer policy, sums current Ed25519 signer weight, and requires at least one current signer signature plus the current **medium threshold** before freeze. This keeps a normal Stellar account with medium threshold `0` from appearing authorized while its Soroban address credential is still unsigned.
6. All signatures for one auth entry share one expiration ledger. Signature vectors are canonicalized by raw Ed25519 public-key bytes and capped at Stellar's 20-signature transaction limit.
7. `SorobanTransactionData` must already be assembled before Request creation. The Request service independently revalidates the final XDR, current ledger, expiration, signatures, and live authorizer policy; browser state is never trusted as authorization proof.
8. Local auth-entry verification cannot prove that a client did not omit an authorizer required by contract execution. Therefore Proposal creation performs a server-side `simulateTransaction` with `authMode=enforce` on the exact frozen XDR. Missing/invalid contract authorization rejects the freeze; RPC unavailability fails closed without marking the transaction invalid.
9. Submit repeats the same enforce simulation immediately before broadcast. It does not run on ordinary Proposal reads or on each envelope-signature contribution.
10. The Review recording simulation remains `authMode=record`. The automatic enforce checks are separate consequences of the Human's explicit Continue/Submit actions; the UI must disclose that the server sends the exact XDR to its configured RPC provider at those boundaries.
11. After freeze the current Request remains immutable. Auth expiration or authorizer-policy drift blocks the Proposal and requires a fresh Review/Proposal rather than mutating the frozen body.
12. Envelope signatures are collected only after this preparation is complete. Existing `Add signed XDR`, signature merge, Submit, Receipt, and Activity ownership remain the normal Proposal path.
13. Pre-freeze G-account authorization is collaborative but remains outside the immutable Proposal. After any partial auth-entry signature, Review can export the exact prepared XDR or QR to another signer; importing that prepared XDR continues from its embedded auth evidence without running recording simulation again, because record simulation intentionally rebuilds the authorization topology and would discard prior auth-entry signatures. Same-browser wallet switching remains an optional convenience, not the collaboration model. Proposal creation still occurs only after authorization is complete and the exact XDR passes the server-side enforce boundary.

Unsupported auth shapes fail closed before freeze. `ADDRESS_WITH_DELEGATES`, C-account/custom `__check_auth` signatures, fee-bump Soroban preparation, restoration flows, and hardware-wallet auth-entry signing remain outside this milestone.

### Real Testnet proof

The S2 contract/Request path has a real Testnet fixture at `test-contracts/g-account-auth`. Its `authorize(actor, marker)` function calls `actor.require_auth()` where the transaction source is a different G-account, then persists `(actor, marker)` for readback.

On 2026-09-08 the fixture was deployed as `CDRUWVHO5AVC42PGJ5S3EHX2Z7OCTJEDMTTZQBW5QWQOC4QXHPGQGGSQ`. A MultiSigTools live run used fresh disposable Friendbot-funded source/actor accounts and completed record simulation -> detached CAP-71 G-account auth -> enforce -> Proposal freeze -> source envelope signature -> enforce -> Testnet submit. Transaction `28ed82f05a15bf8979f98f5a05d851a99e237b1f32a83f5d5a964928df3aca3a` succeeded in ledger `4565825`, and the script read `last()` back as `["GACN47BFXJABI3KRDRED2FJAR5TBWEFHRPCBDXS52HEPRZ2A3IZWABME", 108]`.

Browser acceptance separately imported a real Stellar CLI `--build-only` Testnet XDR, ran SDF RPC simulation in Chromium, discovered the detached G authorizer, assembled the CLI `precondNone` transaction, and reached Authorization preparation on both desktop and 390x844 mobile layouts with no horizontal overflow or uncaught page error.

A later real-wallet proof used Freighter 5.48.0 in the isolated VPS browser profile without reading or importing either recovery phrase. Freighter Account 1 (`GABOKMM7H2JER72ZH3CB2NUP6UXG4JVP3PY2LMTC2ELRFM3OYZHMBEBI`) and Account 2 (`GB54KYLUKXMW3TMNRT5LVZ2UI5N6ZHNJMOLLPRPBTZW2JFMFPYRDD2AE`) were both funded on Testnet. The disposable authorizer `GBD4SBNXR7LB4HHUY2SEJ5MY5JMKTTWC7MOXOVMJYQCTGBLV4LDUI6MT` had master weight 0, signer A +1, signer B +1, and medium threshold 2. MultiSigTools recorded the first real Freighter `signAuthEntry` as 1/2 approval power, switched signer wallet through the product UI, recorded the second as 2/2, and reached `Soroban authorization complete`. Re-running RPC simulation reset the old signatures back to 0/2, proving re-simulation does not silently retain stale auth-entry evidence. After 2/2, the primary action correctly required a transaction-signer handoff; switching back to Account 1 changed it to `Continue to signatures` because Account 1 was the sole live signer of the disposable transaction source.

This local browser proof stops at the Proposal boundary because plain Vite does not emulate the repository Vercel Functions: `/api/auth` is served as TypeScript source instead of the JSON API contract. That is a local dev-server limitation, not Soroban authorization evidence. The already-completed Request-service/Testnet proof remains the on-chain freeze/sign/submit evidence. The repeatable public-address-only fixture generator is `scripts/prepareSorobanFreighterE2e.ts`.

## 7. S3A — read-only contract-account authorization foundation

S3 begins at the inspection and evidence boundary, not at passkey signing. A C-address in a Soroban authorization entry is now classified as a contract-account authorizer. MultiSig Tools can display the C-address, credential state, expiration, and complete authorized invocation tree without treating the credential payload as locally verified signer evidence.

The verification boundary is explicit:

- G-account standard Ed25519 authorization remains locally cryptographically verifiable under the S2 rules;
- C-account authorization is **contract/network enforced**. The Host invokes the account contract's `__check_auth` implementation during authorization enforcement;
- the signature `ScVal` is contract-defined evidence. It may contain passkey/WebAuthn material, custom multisig data, session/policy credentials, or another format entirely;
- therefore even an opaque payload that happens to resemble an Ed25519 vector is not proof that MultiSig Tools understands or has validated the account contract's policy;
- `addressWithDelegates` is likewise inspect-only in S3A because delegated contract authorization may involve additional contract-defined checks.

S3A does not create, mutate, or sign C-account/delegated credentials. Authorization preparation remains blocked for those shapes, so they cannot enter the ordinary Proposal freeze through an unsupported client-side path. Future signing support must produce a credential that passes server-side `authMode=enforce` before the existing immutable Proposal flow can begin.

This preserves one ownership model: Review explains the invocation and evidence; the account contract/network owns custom authorization validity; Proposal begins only after the transaction body is final and enforce-valid.

### Real Testnet C-account read-only proof

The existing Testnet fixture workspace now also contains `contracts/simple-account-auth`, a minimal custom account implementing `__check_auth` with an Ed25519 owner. Its purpose is inspection evidence only; S3A does not build or submit a credential for it.

On 2026-09-08 it was deployed as `CBUGCD3J6RCTJ5RVK7SGDV63JKV7E5YMULD5HAXQ7BGHNLB5DYVVZIEH`. A build-only call to the existing `g-account-auth` contract used this C-address as `actor` with marker `301`. Real SDF Testnet record simulation returned one detached authorization entry with `authorizer=CBUG...ZIEH`, `authorizationKind=contract-account`, `verificationModel=contract-check-auth`, and no signature payload; assembly succeeded while authorization preparation remained fail-closed with the S3A read-only `__check_auth` explanation.

The same XDR was imported through the ordinary Chromium Human flow. Review displayed `Contract account (__check_auth)` and `Contract/network-enforced authorization · read only`, showed the authorized invocation tree, and rendered `Authorization preparation blocked` rather than a G-account signer action. Desktop and 390x844 mobile checks had zero horizontal overflow, zero uncaught page errors, and zero failed requests. The same gate passed against the final production `dist` through Vite preview, not only the development server. No custom credential was generated and the marker-301 contract call was not submitted.

## 8. S3B — contract-defined credential transport and enforced preparation

S3B adds a contract-neutral transport boundary without pretending that MultiSig Tools understands every account contract's authentication scheme. Review owns the authorization challenge. A contract-specific adapter may answer that challenge, but it may not redefine it.

The challenge binds `network`, auth-entry index, C-address authorizer, expiration ledger, the exact `HashIdPreimageSorobanAuthorization` XDR, and its 32-byte signing payload hash. Before staging a response, MultiSig Tools recomputes the challenge from the current envelope and rejects stale transaction state, a different network, authorizer, entry, expiration, or payload hash. The adapter contributes one complete contract-defined `signatureScValXdr`; the core does not reinterpret that `ScVal` as Ed25519, passkey, multisig, or any other policy.

Staging is deliberately not a validity claim. Its result is marked `requires-rpc-enforce`. Custom `__check_auth` is omitted by recording simulation, so after the credential is staged MultiSig Tools must run `authMode=enforce` and re-assemble the returned transaction data/resource fee **before** transaction-envelope signing. The enforcing re-preparation must preserve the finalized auth entries byte-for-byte and preserve the original transaction preconditions, including CLI-style `precondNone`. Only the resulting resource-complete XDR is a candidate for Proposal freeze.

This ordering is required because contract-account authentication can itself read contract state and consume Host resources. Running enforcement only as a yes/no check is insufficient: the enforcing simulation's footprint and resource budget are part of the transaction that will execute. Soroban auth signatures remain valid across that resource refresh because their preimage binds the network, nonce, expiration, and authorized invocation tree rather than the transaction fee/resource envelope.

At the S3B checkpoint the Human product did **not** expose a C-account signing action, and Request creation still failed closed for C-account authorization. S3B proved the core transport/preparation contract first; S3C below adds one explicit adapter/provenance Human path without generalizing that boundary.

### Adapter boundary

`signAuthEntry` is not treated as a universal C-account codec. Current SEP-43-style wallet implementations may return a raw signature for the wallet's own key, while a contract account can define any `Signature` type for `__check_auth`. An adapter therefore owns only conversion from its signer mechanism into the account contract's complete signature `ScVal`. For the test-only `simple-account-auth` fixture, that adapter is intentionally trivial: sign the challenge hash with the configured Ed25519 owner and encode the 64-byte result as `BytesN<64>` / `scvBytes`.

No generic adapter registry, contract discovery protocol, passkey UI, WebAuthn credential flow, delegated-auth signer, or mutable post-freeze auth collection is introduced here.

### Real Testnet S3B proof

On 2026-09-08 a fresh `simple-account-auth` instance was deployed on Testnet as `CCCDIKQCEOIWDSHM3CLUFDXV7Z2KVZINC67GQY2YOTHYIRP27LCV5JWL`, owned by `GABV6GC3CSLADUB2TTSNS57HZ36THLZORSEU6II5DEMHVYQC44WCY5KJ`. Deployment transaction: `df37f6e4d3ab6ed5a795ed3669d8c07814f6eb359fd48bff8db62ae1fe3500e5`.

The existing `g-account-auth` fixture called `authorize(actor, marker)` with that C-address and marker `302`. A first real attempt performed record simulation, built the correct contract-defined credential, staged it, and successfully passed enforcing simulation, but then submitted the record-mode resource envelope unchanged. Testnet rejected it with `resource_limit_exceeded`. This was the concrete proof that C-account `__check_auth` resources cannot be discarded after enforcement.

The corrected run performed record simulation -> challenge -> fixture adapter -> staged `ScVal` -> `authMode=enforce` **plus resource re-preparation** -> verification -> transaction-envelope signature -> final enforcement -> Submit. Transaction `a5357d32ec3a2d3ff129ffea47df61ef257e102ab36b4fc6d97a4f430ef785fd` succeeded in ledger `4568692`. A read-only `last()` simulation then returned `["CCCDIKQCEOIWDSHM3CLUFDXV7Z2KVZINC67GQY2YOTHYIRP27LCV5JWL",302]`, proving that the exact C-account authorized invocation executed on Testnet.

## 9. S3C — one explicit Human contract-account adapter

S3C integrates the S3B transport into Human Review without creating a generic smart-wallet layer. The first supported adapter is deliberately narrow: a **Simple Ed25519 contract account** whose exact C-address and owner G-address are configured by the project for one Stellar network. Configuration is provenance, not authentication. Review shows the adapter type, exact contract account, exact configured owner, and that the mapping is project-configured before any signing action is enabled.

The supported shape is intentionally bounded:

- one non-fee-bump `InvokeHostFunction` transaction;
- transaction-source authorization may coexist with the detached contract authorization;
- exactly one detached C-account authorizer;
- the C-address must exactly match the configured adapter contract for that network;
- the selected wallet must exactly match the configured owner G-address;
- `addressWithDelegates`, multiple detached contract authorizers, and unknown C-accounts remain inspect-only/fail-closed.

The adapter does not change the S3B challenge. Review derives the exact challenge, passes that preimage to the existing wallet `signAuthEntry` transport, requires the returned signer address to equal the configured owner, requires an exact 64-byte Ed25519 signature, verifies that signature locally against the configured owner and exact Review challenge payload, and encodes only that signature as the Simple Account contract's `scvBytes` credential. This local check proves only the adapter's owner-signature claim; it does not prove the account contract's full authorization policy, for which network `__check_auth` remains authoritative. This encoding rule belongs to this one adapter; it is not a generic interpretation of C-account credentials.

After staging, Review immediately runs `authMode=enforce` and re-prepares the transaction from the enforcing simulation's resource output. `onPreparedXdrChange(..., true)` is reached only after that enforce-and-reprepare succeeds. An imported C-account XDR that already carries opaque credential evidence is not silently adopted into the Human adapter flow; Review requires a fresh unsigned recording so adapter provenance is established before the Human signs.

The Request boundary independently repeats the trust decision. It re-identifies the exact configured C-account from the frozen XDR, checks that its credential is present and unexpired, and then runs the existing server-side enforce verifier before creating the Proposal. Later Request projections re-check the configured contract-account shape and expiration; Submit still performs the existing final exact-XDR enforce check. Browser readiness is therefore never sufficient by itself.

The optional public configuration keys are:

- `STELLAR_SOROBAN_SIMPLE_ACCOUNT_PUBLIC_CONTRACT`
- `STELLAR_SOROBAN_SIMPLE_ACCOUNT_PUBLIC_OWNER`
- `STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT`
- `STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER`

Both values for a network must be present and valid together. With no matching configuration, behavior remains the S3A read-only/fail-closed path.

### S3C real Testnet evidence

Human Review was exercised in real Chromium against a fresh Testnet Simple Ed25519 account contract `CDP3QXJ7EMPJ3PU7KWGXVPCK3FDX2IAL373HDBIKPOY3KRZAVXK3ZY4J`, configured to owner `GABOKMM7H2JER72ZH3CB2NUP6UXG4JVP3PY2LMTC2ELRFM3OYZHMBEBI` (deployment transaction `5f0ea245756e4e16c2c946c50659226b73d1231cfafacce52d9fbb54922470ea`). An unsigned CLI-built call to `g-account-auth.authorize(actor, 303)` entered the ordinary Import -> Review flow. Explicit SDF RPC simulation discovered exactly one C-account auth entry. The Human surface then rendered `Known contract-account adapter`, the exact C-address, the exact configured owner, `Simple Ed25519 contract account · project configured`, and `Owner signature required`. Desktop and 390x844 mobile layouts both had zero horizontal overflow; there were zero uncaught page errors and zero request failures. The persistent Freighter test profile was locked, and the environment did not permit automatic reuse of its stored unlock credential, so this browser proof intentionally stops at the owner-wallet action. It does **not** claim that Freighter completed the S3C signature in this run.

The complete adapter/network path was separately proven with a disposable Testnet owner whose secret existed only in the ephemeral test process. Final proof owner `GDQXLP6UL6RU675ZME3AU5KBUVGHOUFTSLDHGD7YCNLVKWNKY2EXM26O` owned fresh C-account `CDHSXG2CFZAHNHQ74W4UCP7HVAHOT4PHPFHZBPN7TSKN7YRC726WLYQM` (deployment transaction `5a999d3b17f7510461f5d3ad1855eefd67b04671f2d925e45adf0d49129a7176`). The repository code recorded the C-account auth for marker `305`, derived the exact Review challenge, locally verified the owner's 64-byte Ed25519 signature against the challenge payload, staged the adapter-defined `scvBytes`, returned `requires-rpc-enforce`, ran enforce-and-reprepare, and reclassified the exact XDR as ready. The signed transaction `bf42ecd3fb4817ab4138f30fcbaf63de717e435230410b26506f20593ad5c473` finished `SUCCESS`, and a subsequent `g-account-auth.last()` read returned `[CDHSXG2CFZAHNHQ74W4UCP7HVAHOT4PHPFHZBPN7TSKN7YRC726WLYQM, 305]`. This proves the adapter encoding and challenge binding against the actual Simple Account `__check_auth`; server Proposal freeze remains independently protected by its own exact-XDR enforce verifier.

## 10. Non-goals for this milestone

S3C adds no new route, workspace, lifecycle step, durable storage schema, npm dependency, universal contract composer, generic adapter registry, passkey/WebAuthn credential flow, delegated-auth signer, fee-bump Soroban preparation, hardware-wallet auth-entry signing, or Vercel/operator change. It supports one explicit project-configured Simple Ed25519 contract-account adapter only. G-account S2 behavior and the S3B contract-neutral challenge/staging primitives remain unchanged.


## 11. Spec-driven Human contract composer

The guided composer now creates semantic Soroban Intent rather than an early transaction:

```text
C... contract id
  -> load live on-chain contract spec
  -> select callable function + encode supported SCSpec arguments
  -> POST /api/intent (no transaction source/lifetime)
  -> recording simulation discovers detached AuthorizationPlan
  -> collect detached AUTH on the durable Intent
  -> authorization_ready
  -> choose execution source
  -> fresh sequence + enforcing simulation + final unsigned XDR
  -> ordinary Proposal/Sign only when envelope multisig is required
```

The guided input set remains conservative: supported primitive SCSpec types are encoded exactly; complex types stay visible but may require advanced tooling until a real editor is justified. Contract-provided names/docs are ABI facts, not trusted business semantics.

Import XDR remains an advanced entry point, but it no longer creates a second transaction-first authorization lifecycle. Supported unsigned prepared InvokeHostFunction XDR is converted into the same source-free Intent model. Existing detached AUTH evidence is retained; transaction source, sequence, fee, timebounds and resource shell are discarded. Envelope-signed imports and `SOURCE_ACCOUNT` authorization fail explicitly instead of being coerced into the Intent model.

Hardware wallets may still sign the final Stellar transaction envelope. Detached Soroban auth-entry signing depends on wallet transport support; when a hardware wallet cannot provide it, another current signer contributes AUTH to the shared Intent.
