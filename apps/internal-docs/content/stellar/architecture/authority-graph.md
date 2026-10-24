---
title: "MultiSigTools Authority Graph"
description: "Internal MultiSig Tools engineering documentation."
---

Status: architecture baseline

## Purpose

MultiSigTools uses Authority Graph to describe derived control relationships between Stellar resources. It is a projection of chain facts, not a source of truth.

## Core distinction

```
Ledger facts
    -> Authority resolver
    -> Authority Graph projection
    -> Workspace UI
```

The graph can become stale. Any action boundary must revalidate current authority.

## Nodes

- Stellar account (G-address)
- Soroban contract (C-address)

## Relations

Examples:

```
signer-of
controls
admin-of
authorized-by
```

Example:

```
GBBBB
  |
  signer-of
  |
GAAAA
  |
  controls
  |
CXXXX
```

This means GBBBB may participate in operations controlled by GAAAA when the current chain state confirms the relation.

## Workspace relationship

Workspace is a Human surface, not an authority source.

```
Workspace
  |
  +-- Account Treasury
  |
  +-- Contract Workspace
```

Importing a contract creates a view. It does not grant permission.

## Action rule

Discovery may use projections:

```
Who can manage this?
```

Signing/submission must verify:

```
Can this signer act now?
```
