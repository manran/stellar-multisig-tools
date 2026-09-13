# MultiSigTools Beta Terms of Service

**Effective:** 2026-09-01  
**Status:** practical beta terms; obtain qualified legal review before relying on these terms for a regulated or commercial production launch.

By using MultiSigTools, you agree to these beta terms.

## 1. Service role

MultiSigTools provides tools for preparing, reviewing, coordinating signatures for and submitting Stellar transactions. It is non-custodial: the service does not take possession of your Stellar private keys or seed phrases.

MultiSigTools is not a bank, exchange, broker, custodian, fiduciary, accounting system or legal/financial adviser.

## 2. Your responsibility for transactions

You are responsible for reviewing the exact network, source account, operations, amounts, assets, counterparties, signer policy and transaction conditions before authorizing or submitting a transaction.

A Signing Request, Inbox item, Box name, Private Note, API-origin label or other off-chain context does not by itself prove that a transaction is legitimate. Stellar authorization and final ledger execution are determined by the network and the transaction data.

Accepted blockchain transactions may be irreversible.

## 3. Agent and Audit credentials

A Stellar signer may create named Agent credentials with cumulative `Read`, `Write`, or `Sign` access. The Agent credential identifies a distinct software actor delegated by that signer Principal; it is not a Stellar private key and cannot satisfy a Stellar threshold merely by authenticating to MultiSig Tools.

A Treasury may also expose a separate observer-only Audit credential for that Treasury's Activity. It cannot create Requests, contribute signatures, submit transactions, read a signer's personal Inbox/Address Book, or administer the Treasury.

You are responsible for protecting credential secrets and revoking them after suspected compromise. Agent Request creation requires stable idempotency and current signer access.

## 4. Private data

Some Request and Box data is stored privately by the service, but private service storage is not represented as end-to-end encryption. See the Privacy Notice for the categories of data processed and retention boundaries.

Do not place secrets, seed phrases, API keys or unnecessary regulated/sensitive personal data in Private Note.

Accepted Request and audit records are durably retained in the current beta. Request expiry stops active collaboration but does not automatically delete stored history or Private Note/private context. Do not submit private content that you are unwilling for the service to retain under this beta policy.

## 5. Availability and third parties

MultiSigTools depends on Stellar network services, wallets, Horizon/RPC providers and hosting/storage infrastructure. The service may be unavailable, delayed or unable to evaluate current signer or ledger state when those dependencies fail or change.

The beta service has no guaranteed uptime, response time, transaction-settlement time or service-level agreement unless separately agreed in writing.

## 6. No guarantee of transaction execution

`ready` means the current Request evaluation believes required authorization and relevant preconditions are satisfied. It does not mean the transaction has been submitted or will be accepted by Stellar. Sequence changes, ledger state, network fees, account policy changes, time bounds or other conditions can cause later failure.

## 7. Prohibited use and protection of the service

You must not use MultiSigTools to bypass authorization, probe or access another user's private Request/Box data, overload service endpoints, distribute malicious payloads, or interfere with the service or its dependencies.

The service may rate-limit, block, revoke credentials, restrict access or suspend features to protect users and infrastructure.

## 8. Beta changes

Features, APIs, storage formats, limits and retention behavior may change during beta. Where a change affects an integration contract or security boundary, MultiSigTools should publish updated documentation and migration guidance when practical.

## 9. Limitation of reliance

You should maintain independent operational controls appropriate to the value and risk of the assets you manage, including backups, signer recovery procedures, reconciliation, monitoring and review of high-value transactions.

Do not treat current MultiSigTools Activity/audit storage as a substitute for a regulatory WORM archive or your own required books and records.

## 10. Contact / governing legal details

Operator identity, contact details, governing law, dispute procedure and jurisdiction should be completed before a public commercial launch. This beta draft intentionally does not invent those legal facts.
