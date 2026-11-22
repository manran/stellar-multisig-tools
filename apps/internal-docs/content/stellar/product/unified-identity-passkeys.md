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
3. **First Passkey**: a walletless recipient registers a discoverable, UV-required Passkey
   with WebAuthn. Only verified registration consumes the invitation and creates the User
   and Template grant in a single database transaction.
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
- One-time links are confidential until accepted. Avoid displaying invite tokens in
  logs, analytics, public URLs/Referer headers. Secure logs, rate limits, and origin
  policies are a release gate.

## Test and deployment gates

1. Migrate `0017_unified_identity.sql` on **Testnet PostgreSQL** after a recoverable
   encrypted backup. Existing 0016 data remains. No automatic Mainnet migration.
2. Isolated database tests: 17 migrations in order, concurrent wallet identity creation,
   unique credential subjects, Passkey counters, one-use/expiry challenges,
   invitation redemption/revocation, User grant and Request binding/locking.
3. Chromium virtual WebAuthn authenticator: verified registration, authentication,
   and wrong challenge rejection; run Node 24 repository CI and browser QA.
4. Real-world Testnet: verified wallet inviter → walletless Passkey recipient →
   fixed-template Request → real Treasury signers → confirmed ledger → returning
   Passkey Activity/receipt. Verify link expiration/revocation and two-method login.
5. Review abuse controls for unauthenticated Passkey challenge endpoints,
   WebAuthn RP/origin settings, invitation/referrer handling, public response privacy,
   account recovery, and real Resend email delivery before public Testnet beta.
6. Do not enable Mainnet deployment or announce public Testnet beta until the user
   explicitly approves the UI and release acceptance results.

## Out of scope for first release

Org/team hierarchy, password login, email-only login, automatic wallet generation,
manual cross-account merges, OAuth/OIDC/SSO integrations, arbitrary transaction
proposer grants, and new Stellar signing rights.
