# MultiSigTools Privacy Notice

**Effective:** 2026-09-01  
**Status:** beta operational notice; review with qualified counsel before representing a regulated deployment.

MultiSigTools is a non-custodial transaction-coordination service. It does not ask for or store Stellar seed phrases or private signing keys.

## Data the service processes

Depending on the feature used, MultiSigTools may process and store:

- Stellar public addresses, account signer configuration and other public ledger data;
- unsigned, partially signed or signed transaction XDR;
- transaction hashes, Request lifecycle state, signatures and submission results;
- private Request capabilities in hashed/verifier form where applicable;
- private-workspace authentication/session records;
- Request participants and Activity/audit records;
- personal private Address Book aliases;
- shared Treasury Box names and Box administration metadata;
- signer-owned Agent credential metadata and Treasury Audit credential metadata such as label, public prefix, Principal/creator, last-use time and revocation state;
- one-way credential hashes used to verify presented Agent/Audit secrets;
- optional Private Note plaintext supplied for Request coordination;
- operational and security logs needed to run and protect the service.

Complete Agent/Audit credential secrets are returned only when created and are not stored in plaintext by MultiSig Tools.

## Public blockchain data

Stellar ledger data is public. If a transaction is submitted, transaction contents and signatures that the Stellar protocol publishes become public and are subject to the network's permanent/distributed retention characteristics. MultiSigTools cannot delete or reverse an accepted Stellar transaction.

## Private Note

Private Note is off-chain data stored in private service storage and returned only through the applicable Request authorization boundary. It is **not end-to-end encrypted**. MultiSigTools infrastructure can process the plaintext to provide the service.

Stellar transaction signatures do not attest the text of an off-chain Private Note. Note revisions are append-only application records so changes can be audited.

Private Note plaintext is not intentionally copied into Box audit events or ordinary application logs.

## Private Commitment

Where the Human product uses a Private Commitment, plaintext/opening data remains off-chain while a cryptographic commitment may be placed in the Stellar transaction memo field. Revealing the opening data later may allow another party to verify the commitment.

## Agent and Treasury Audit credentials

Signer-owned Agent credentials delegate `Read`, `Write`, or `Sign` API access from one Stellar signer Principal to a distinct Agent actor. Treasury Audit credentials are separate fixed-scope observer credentials for one Treasury's Activity. Neither credential type contains a Stellar private key or satisfies a Stellar threshold merely by authenticating to MultiSig Tools.

Complete credential secrets are displayed only at creation. MultiSig Tools stores one-way verifier hashes plus non-secret metadata needed for management and audit. Credentials can be revoked independently.

## Retention

Request expiry is a collaboration boundary, not a deletion timer. Once MultiSig Tools accepts a durable Request, the current beta does not schedule physical deletion of its Request record, signature contributions, submission result, participant evidence, Activity events, Private Note/private context, or related administration history.

This durable-retention choice supports future audit and evidence use, but current application storage is not represented as regulatory WORM/object-lock or independently immutable infrastructure. A future explicit privacy/erasure feature may cryptographically erase or redact sensitive plaintext while retaining immutable hashes and an audit event describing that action; no such automatic erasure policy is enabled today.

Because accepted records are durable, the service restricts writes before acceptance through identity/authorization checks and payload-size limits and should also enforce infrastructure rate limits and quotas.

## Security logging

Security/audit records are designed not to contain seed phrases, private keys, complete API-key secrets, bearer capabilities, raw Authorization headers or Private Note plaintext. Transaction identifiers and hashes may be recorded where needed to connect an audit event to the affected Request.

## Third parties and infrastructure

The service depends on infrastructure providers and Stellar network services, including hosting/storage and Horizon/RPC endpoints. Those providers may process normal network metadata according to their own policies.

## Changes

The service is in beta. This notice may change as features, retention controls, Workspace/team functions or infrastructure change. Material changes should be published with a new effective date.
