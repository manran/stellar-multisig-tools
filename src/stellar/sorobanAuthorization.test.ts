import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  hash,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import {
  analyzeSorobanGAccountAuthorization,
  initializeSorobanGAccountAuthorizationWindow,
  mergeSorobanGAccountSignature,
  sorobanAuthorizationPreimageXdr,
} from '../../packages/stellar-core/src/sorobanAuthorization.js';
import type { StellarAccountSnapshot } from '../../packages/stellar-core/src/types.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

function accountSnapshot(
  accountId: string,
  signers: Array<{ key: string; weight: number }>,
  medium = 2,
): StellarAccountSnapshot {
  return {
    accountId,
    sequence: '1',
    subentryCount: signers.length,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium, high: medium },
    signers: signers.map((signer) => ({
      key: signer.key,
      type: 'ed25519_public_key',
      weight: signer.weight,
    })),
  };
}

function unsignedAuthorizationEntry(authorizer: string, invocation: xdr.SorobanAuthorizedInvocation) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(authorizer).toScAddress(),
        nonce: xdr.Int64(42n),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: invocation,
  });
}

function contractCallFixture() {
  const source = Keypair.random();
  const authorizer = Keypair.random();
  const signerA = Keypair.random();
  const signerB = Keypair.random();
  const outsider = Keypair.random();
  const contract = new Contract(CONTRACT_ID);
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_invoice',
    args: [nativeToScVal(authorizer.publicKey()), nativeToScVal('invoice-42')],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
  const sourceAuthorization = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  });
  const detachedAuthorization = unsignedAuthorizationEntry(authorizer.publicKey(), invocation);
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
      auth: [sourceAuthorization, detachedAuthorization],
    }))
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(3600)
    .build();
  const account = accountSnapshot(authorizer.publicKey(), [
    { key: signerA.publicKey(), weight: 1 },
    { key: signerB.publicKey(), weight: 1 },
  ]);
  return { transaction, source, authorizer, signerA, signerB, outsider, account };
}

function signPreimage(preimageXdr: string, signer: Keypair): string {
  const preimage = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
  return Buffer.from(signer.sign(hash(preimage.toXdr()))).toString('base64');
}

function withPrecondNone(envelopeXdr: string): string {
  const envelope = xdr.TransactionEnvelope.fromXdr(envelopeXdr, 'base64');
  assert.equal(envelope.type, 'envelopeTypeTx');
  if (envelope.type !== 'envelopeTypeTx') throw new Error('Expected v1 transaction envelope.');
  const source = envelope.value.tx;
  const transaction = new xdr.Transaction({
    sourceAccount: source.sourceAccount,
    fee: source.fee,
    seqNum: source.seqNum,
    cond: xdr.Preconditions.precondNone(),
    memo: source.memo,
    operations: source.operations,
    ext: source.ext,
  });
  return xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({ tx: transaction, signatures: [] }),
  ).toXdr('base64');
}

async function addSignature(
  xdrValue: string,
  signer: Keypair,
  expirationLedger = 500,
) {
  const preimageXdr = sorobanAuthorizationPreimageXdr({
    envelopeXdr: xdrValue,
    network: 'testnet',
    entryIndex: 1,
    expirationLedger,
  });
  return mergeSorobanGAccountSignature({
    envelopeXdr: xdrValue,
    network: 'testnet',
    entryIndex: 1,
    signerPublicKey: signer.publicKey(),
    signatureBase64: signPreimage(preimageXdr, signer),
    expirationLedger,
  });
}

test('initialized G-account authorization lets independent signers share one stable CAP-71 preimage', async () => {
  const fixture = contractCallFixture();
  const initialized = await initializeSorobanGAccountAuthorizationWindow({
    envelopeXdr: fixture.transaction.toXdr(),
    network: 'testnet',
    currentLedger: 100,
    expirationLedgers: 400,
  });
  const status = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: initialized,
    network: 'testnet',
    currentLedger: 100,
    accountLoader: async () => fixture.account,
  });
  assert.equal(status.supported, true);
  assert.equal(status.ready, false);
  assert.equal(status.expired, false);
  assert.equal(status.authorizers[0].expirationLedger, 500);
  assert.equal(status.authorizers[0].signerEvidence.length, 0);

  const preimageA = sorobanAuthorizationPreimageXdr({
    envelopeXdr: initialized,
    network: 'testnet',
    entryIndex: 1,
    expirationLedger: 500,
  });
  const signedByA = await mergeSorobanGAccountSignature({
    envelopeXdr: initialized,
    network: 'testnet',
    entryIndex: 1,
    signerPublicKey: fixture.signerA.publicKey(),
    signatureBase64: signPreimage(preimageA, fixture.signerA),
    expirationLedger: 500,
  });
  const preimageAfterA = sorobanAuthorizationPreimageXdr({
    envelopeXdr: signedByA,
    network: 'testnet',
    entryIndex: 1,
    expirationLedger: 500,
  });
  assert.equal(preimageAfterA, preimageA);

  const merged = await mergeSorobanGAccountSignature({
    envelopeXdr: signedByA,
    network: 'testnet',
    entryIndex: 1,
    signerPublicKey: fixture.signerB.publicKey(),
    signatureBase64: signPreimage(preimageA, fixture.signerB),
    expirationLedger: 500,
  });
  const ready = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: merged,
    network: 'testnet',
    currentLedger: 100,
    accountLoader: async () => fixture.account,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.authorizers[0].signedWeight, 2);
});

test('G-account Soroban auth accumulates Ed25519 signer weight before Proposal freeze', async () => {
  const fixture = contractCallFixture();
  const load = async (accountId: string) => {
    assert.equal(accountId, fixture.authorizer.publicKey());
    return fixture.account;
  };
  const one = await addSignature(fixture.transaction.toXdr(), fixture.signerB);
  const oneEnvelope = TransactionBuilder.fromXdr(one, Networks.TESTNET).toEnvelope();
  assert.equal(oneEnvelope.type, 'envelopeTypeTx');
  if (oneEnvelope.type === 'envelopeTypeTx') assert.equal(oneEnvelope.value.tx.ext.type, 'sorobanData');
  const oneStatus = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: one,
    network: 'testnet',
    currentLedger: 100,
    accountLoader: load,
  });
  assert.equal(oneStatus.supported, true);
  assert.equal(oneStatus.ready, false);
  assert.equal(oneStatus.authorizers[0].signedWeight, 1);
  assert.equal(oneStatus.authorizers[0].threshold, 2);

  const two = await addSignature(one, fixture.signerA);
  const twoStatus = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: two,
    network: 'testnet',
    currentLedger: 100,
    accountLoader: load,
  });
  assert.equal(twoStatus.ready, true);
  assert.equal(twoStatus.authorizers[0].signedWeight, 2);
  assert.deepEqual(
    [...twoStatus.authorizers[0].signerEvidence.map((item) => item.publicKey)].sort(),
    [fixture.signerA.publicKey(), fixture.signerB.publicKey()].sort(),
  );
});

test('G-account auth-entry replacement preserves CLI-style precondNone exactly', async () => {
  const fixture = contractCallFixture();
  const rawXdr = withPrecondNone(fixture.transaction.toXdr());
  const signedXdr = await addSignature(rawXdr, fixture.signerA);
  const envelope = xdr.TransactionEnvelope.fromXdr(signedXdr, 'base64');
  assert.equal(envelope.type, 'envelopeTypeTx');
  if (envelope.type !== 'envelopeTypeTx') return;
  assert.equal(envelope.value.tx.cond.type, 'precondNone');
  assert.equal(envelope.value.tx.ext.type, 'sorobanData');
});

test('zero medium threshold still requires one active G-account auth signature', async () => {
  const fixture = contractCallFixture();
  const account = accountSnapshot(fixture.authorizer.publicKey(), [
    { key: fixture.signerA.publicKey(), weight: 1 },
  ], 0);
  const unsigned = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: fixture.transaction.toXdr(),
    network: 'testnet',
    currentLedger: 100,
    accountLoader: async () => account,
  });
  assert.equal(unsigned.authorizers[0].threshold, 0);
  assert.equal(unsigned.ready, false);
  const signedXdr = await addSignature(fixture.transaction.toXdr(), fixture.signerA);
  const signed = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: signedXdr,
    network: 'testnet',
    currentLedger: 100,
    accountLoader: async () => account,
  });
  assert.equal(signed.authorizers[0].signedWeight, 1);
  assert.equal(signed.ready, true);
});
test('G-account auth signatures are idempotent and use one shared expiration ledger', async () => {
  const fixture = contractCallFixture();
  const one = await addSignature(fixture.transaction.toXdr(), fixture.signerA, 500);
  const repeated = await addSignature(one, fixture.signerA, 500);
  assert.equal(repeated, one);
  assert.throws(
    () => sorobanAuthorizationPreimageXdr({
      envelopeXdr: one,
      network: 'testnet',
      entryIndex: 1,
      expirationLedger: 600,
    }),
    /different expiration ledger/,
  );
});

test('server-side G-account analysis rejects non-policy signatures and expired auth', async () => {
  const fixture = contractCallFixture();
  const outsiderSigned = await addSignature(fixture.transaction.toXdr(), fixture.outsider);
  const outsiderStatus = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: outsiderSigned,
    network: 'testnet',
    currentLedger: 100,
    accountLoader: async () => fixture.account,
  });
  assert.equal(outsiderStatus.supported, false);
  assert.match(outsiderStatus.reason ?? '', /not a current Ed25519 signer/);

  const valid = await addSignature(
    await addSignature(fixture.transaction.toXdr(), fixture.signerA, 500),
    fixture.signerB,
    500,
  );
  const expired = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: valid,
    network: 'testnet',
    currentLedger: 500,
    accountLoader: async () => fixture.account,
  });
  assert.equal(expired.expired, true);
  assert.equal(expired.ready, false);
});

test('auth-entry mutation is forbidden after transaction-envelope signing begins', async () => {
  const fixture = contractCallFixture();
  fixture.transaction.sign(fixture.source);
  await assert.rejects(
    addSignature(fixture.transaction.toXdr(), fixture.signerA),
    /before transaction-envelope signatures/,
  );
});

test('C-account authorization stays outside the generic G-account policy verifier', async () => {
  const source = Keypair.random();
  const contract = new Contract(CONTRACT_ID);
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_invoice',
    args: [nativeToScVal('invoice-42')],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
  const contractAuthorization = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: contract.address().toScAddress(),
        nonce: xdr.Int64(77n),
        signatureExpirationLedger: 500,
        signature: nativeToScVal(Uint8Array.from([1, 2, 3, 4])),
      }),
    ),
    rootInvocation: invocation,
  });
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
      auth: [contractAuthorization],
    }))
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(3600)
    .build();
  const status = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: transaction.toXdr(),
    network: 'testnet',
    currentLedger: 100,
    accountLoader: async () => { throw new Error('C-account must not load Horizon signer policy'); },
  });
  assert.equal(status.supported, false);
  assert.equal(status.ready, false);
  assert.match(status.reason ?? '', /not handled by the G-account analyzer.*fail closed/i);
});
