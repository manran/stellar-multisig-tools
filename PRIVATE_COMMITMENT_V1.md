# Private Commitment v1

Status: implementation specification

This document fixes the exact byte encoding used by MultiSig Tools Private Commitment before the feature is implemented.

## Commitment input

A v1 private payload is a UTF-8 text string.

Canonicalization:

1. trim leading and trailing Unicode whitespace with JavaScript `String.trim()` semantics;
2. normalize the resulting string to Unicode NFC;
3. encode the canonical string as UTF-8;
4. reject an empty payload;
5. reject payloads larger than 8192 UTF-8 bytes.

The salt is exactly 32 cryptographically random bytes and MUST be newly generated for each new commitment.

## Binary encoding

Let:

```text
domain = UTF8("multisig.tools/private-memo/v1\0")
salt = 32 random bytes
payload = UTF8(NFC(trim(text)))
len = unsigned 32-bit big-endian byte length of payload
```

The commitment preimage is exactly:

```text
domain || salt || len || payload
```

The commitment is:

```text
H = SHA256(preimage)
```

`H` is exactly 32 bytes and is stored as the Stellar transaction's native `MEMO_HASH`.

The length prefix is part of the format even though v1 currently has one payload field. It makes the encoding unambiguous and leaves the domain/version boundary explicit.

## Private record

The server-private Request record stores at least:

```text
version = 1
canonical plaintext
salt (hex)
commitment hash (hex)
createdAt
```

This is server-private storage, not E2EE. The current backend/operator can process the plaintext.

## Request creation invariant

When a Request is created with Private Commitment context, the server MUST recompute `H` from the submitted plaintext and salt and MUST verify that the transaction memo is `MEMO_HASH(H)` before persisting the Request.

A mismatch fails Request creation. The server never accepts a private payload/salt pair that does not open the transaction's actual commitment.

## Editing invariant

A Private Commitment is immutable for one Request/transaction hash.

Changing plaintext or salt produces a different commitment and therefore a different Stellar transaction. Existing signatures no longer authorize the changed transaction. The product must rebuild the transaction and collect approvals again rather than silently revising committed plaintext in place.

## Reveal

An authorized viewer can later prove the commitment by revealing:

```text
canonical plaintext
salt
version = 1
```

Any verifier can recompute the v1 preimage and SHA-256 hash and compare it with the transaction `MEMO_HASH`.

The hash is an integrity/lookup anchor, not an authorization credential.
