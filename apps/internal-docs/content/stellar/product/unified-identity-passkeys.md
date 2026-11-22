---
title: "Unified MST identity — wallet + Passkey"
description: "Stable User ID, independent authentication methods, Template invitations, and walletless payment requests."
---

## Product invariant

A person has **one stable MST User ID**. They can prove ownership through one or more independent
credentials. The first supported methods are Stellar wallet SEP-53 and WebAuthn Passkey.
The authentication method does **not** determine Treasury signing rights.

The user is not required to have a Stellar address, wallet extension, activated account,
XLM balance, email address, or password to accept an invitation and prepare a delegated
Payment Request. Actual signing/submission remains governed by the current Stellar ledger.

## Data model

- `mst_users`: stable UUID, independent of wallet address, RP credential, and network.
- `mst_auth_credentials`: one-to-many relation with globally unique `kind, subject`.
  Wallet credentials record verified G addresses, not wallet secrets. Passkey credentials
  record credential ID, COSE public key, counter, transports, device kind, and backed-up flag.
  The private Passkey stays in the user's authenticator or password manager.
- `mst_webauthn_challenges`: short-lived 5-minute challenge, consumed atomically once;
  authentication requires **verified user presence and verification** (device PIN/biometric).
- `mst_template_invitations`: 256-bit bearer token stored only as SHA-256 hash,
  24-hour expiry, single use, revocable by a **current verified Template owner signer**.
- `mst_template_user_grants`: active/revoked Template grant for MST User ID, with inviter
  and revocation audit. Old `reusable_template_proposer_grants` G-address grants remain valid.
- `classic_requests.proposer_user_id`: immutable user actor attribution, distinct from
  `proposer_address`, `creator_address`, and Stellar signature evidence.

## Identity flows

1. **Existing wallet**: SEP-53 verifies the G address. MST maps it lazily to a stable
   MST User ID. Wallet authentication and all on-chain signer checks stay as before.
2. **Invite a person**: a current signer owning a fixed payment Template generates a
   one-time invitation. Opening the link only previews its Template name; the recipient
   must authenticate before consuming it.
3. **First Passkey**: anyone may register a discoverable, UV-required Passkey without a
   wallet or invitation. If an invitation is supplied, verified registration consumes it
   and creates the User and Template grant in a single database transaction.
4. **Returning Passkey**: discoverable Passkey challenge + WebAuthn signature creates an
   8-hour HttpOnly Secure SameSite=Strict session. No username, password or G address.
5. **Linking another method**: users already authenticated may add a second Passkey;
   linking a wallet requires **both** an active Passkey session and a fresh verified
   wallet session for the selected address. A wallet already bound to another user is
   never silently merged or stolen. Wallet-only users can register a Passkey into their
   existing MST User ID while authenticated with SEP-53.
6. **Personal workflow**: grants attach to User ID, not login method. Templates, own
   Requests, Inbox and personal Activity are scoped to the same User ID. Non-signers
   cannot contribute signatures, submit via the MST API, or create arbitrary XDR.
7. **Revocation**: owner may revoke invitations or a user grant. Existing Requests and
   chain receipts remain visible to the creator; subsequent delegated creation fails.

## Wallet linking product flow

- **Passkey user, no wallet:** shows a Connect Stellar wallet action; Contacts and Smart Contracts already work.
- **Wallet connected but not linked:** SEP-53 must verify ownership. Show the exact G-address and an explicit Link this wallet confirmation. No implicit account switching.
- **Wallet linked to this MST User:** the verified wallet is another login method. Login may be Passkey or Stellar wallet; on-chain signing still requires the wallet to be an authorized signer.
- **Wallet already owned by another MST User:** return `wallet_already_linked` (409) with an actionable choice. Do not transfer credentials, proposals, or personal data automatically. A user may sign into that wallet account and register a **new** Passkey there. Moving an existing Passkey between two accounts remains an explicit account-migration problem, not a wallet-link side effect.
- **Different selected wallet:** preserve the active Passkey user, show the new wallet as unlinked until verified and confirmed. Changing or locking a wallet does not sign out the Passkey session. Do not show that wallet's signer relationships or treasuries as belonging to the Passkey user until the wallet is linked.
- **Soroban C-address:** a contract address is not a SEP-53 wallet credential. Passkey-based on-chain authority needs an independently verified smart-account policy; this login linking flow does not attach a C-address as a signer.

## User-owned workspace data

- Contacts and saved Contracts belong to the stable **MST User ID** and deployment network, regardless of which linked login method opened the account. A Passkey-only user may view and edit these resources with no Stellar wallet.
- Signer-bound Agent API credentials keep their existing, separate signer workspace. Treasury signer authority, Soroban AUTH and transaction execution remain governed by Stellar; no wallet capability is inferred from an MST session.
- When a wallet is both **verified** and **linked to this User ID**, the API copies existing G-address-owned Contacts/Contracts once into the user's workspace. User-owned entries win on conflicts. The original records stay available, and a durable per-wallet marker prevents deleted entries being reimported.
- Old browser-local contract favorites are not automatically imported: they were not bound to a cryptographic wallet identity. An explicit import flow would be required to move that unscoped data.
- Notifications initiated by a verified G signer use the linked MST user's Contact email if present, otherwise the existing signer-scoped email. An email address is a delivery destination, not a signer credential.

### Security boundaries

- Passkey authentication is **business authority only**. It cannot be transformed into
  a Stellar signature or used as a signer G address. A connected wallet still needs
  its current on-chain signer policy checked separately.
- Server reconstructs exact payment XDR from the immutable fixed Template (source,
  recipient, asset, signing window). Only amount and Memo are proposer inputs.
- Before durable Request insertion, the database transaction takes a row lock on the
  still-active user or legacy wallet grant; a grant revoked first cannot create a new
  Request. Template owner's current signer status is verified at preparation.
- Never expose another user's Passkey public key or full credential IDs in proposals;
  only the signed-in user can list their own authentication methods.
- A linked wallet and Passkey can belong to one User ID. Two **existing** accounts
  are not silently combined. Account merging/recovery is intentionally out of scope
  until reviewed; if the user has lost all methods, the issuer must invite them again.
- Authentication `Origin` and WebAuthn `expectedRPID` are checked; the RP ID uses
  `multisig.tools` on subdomains, with origin checks remaining domain-specific.
  Passkey sessions use a separate cookie and never substitute for SEP-53 in signer routes.
- One-time links are confidential until accepted. The invitation token stays in
  the URL fragment and is sent to the API only in a same-origin JSON POST body;
  it never belongs in a request path, query string, Referer or access log.
  Secure logs, rate limits, and origin policies are a release gate.

## Identity abuse protection

- Migration `0018_identity_rate_limits.sql` adds shared PostgreSQL fixed-window counters;
  no in-memory or Vercel-only limiter is relied on for the self-hosted API.
- Independent five-minute buckets apply per verified edge client and per network/action,
  plus a global cap. Raw IP addresses are not stored. Invalid or missing proxy IP
  headers share a small fallback bucket; they cannot create unlimited identities.
- `registration_options` allows 8 requests per client per five minutes, while
  authentication, verification, invitation, and credential linking have separate
  quotas. Excess returns 429 with `Retry-After`; unavailable quota storage returns 503.
- Only trust the edge-set `CF-Connecting-IP` or Vercel's `X-Vercel-Forwarded-For`.
  Cloudflare Tunnel must remain the sole external path to the Testnet API; do not
  expose the API container directly or trust caller-controlled `X-Forwarded-For`.
- Older counters are pruned opportunistically. Confirm the effective edge headers,
  response status, and retry behavior at the live HTTPS origin before beta.

## Test and deployment gates

1. Back up **Testnet PostgreSQL** (recoverable encrypted backup plus restore check).
   Apply `0017_unified_identity.sql` then `0018_identity_rate_limits.sql` with
   `npm run db:migrate` only after verifying the intended Testnet database URL.
   Existing 0016 data remains. Do not migrate Mainnet.
2. Isolated database tests: 18 migrations in order, concurrent wallet identity creation,
   unique credential subjects, Passkey counters, one-use/expiry challenges,
   invitation redemption/revocation, User grant and Request binding/locking.
3. Chromium virtual WebAuthn authenticator: verified registration, authentication,
   and wrong challenge rejection. The isolated loopback HTTPS acceptance test
   additionally covers the real MST API route, PostgreSQL identity session,
   and HTTP 429. Run Node 24 repository CI and browser QA.
4. Real-world Testnet: verified wallet inviter → walletless Passkey recipient →
   fixed-template Request → real Treasury signers → confirmed ledger → returning
   Passkey Activity/receipt. Verify link expiration/revocation and two-method login.
5. Confirm the Testnet Human origin responds on `/api/identity?network=testnet`
   before any WebAuthn acceptance: 200 and `authenticated:false` when signed out,
   not 404 or a response from another domain. Verify `expectedOrigin` is the exact
   Human HTTPS origin and `expectedRPID` is `multisig.tools`. Check Secure,
   HttpOnly, SameSite cookie and network isolation. Reject repeated challenges and
   verify the 429/503 quota behavior from the actual edge route.
6. Review invitation/referrer handling, public response privacy, account recovery,
   and real Resend email delivery before public Testnet beta.
7. Do not enable Mainnet deployment or announce public Testnet beta until the user
   explicitly approves the UI and release acceptance results.

## Out of scope for first release

Org/team hierarchy, password login, email-only login, automatic wallet generation,
manual cross-account merges, OAuth/OIDC/SSO integrations, arbitrary transaction
proposer grants, and new Stellar signing rights.
