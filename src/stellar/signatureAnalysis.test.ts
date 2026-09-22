import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  hash,
} from '@stellar/stellar-sdk/base';
import { analyzeEnvelopeSignatures } from '../../packages/stellar-core/src/signatureAnalysis.js';

function paymentTransaction() {
  const source = Keypair.random();
  const destination = Keypair.random();
  const account = new Account(source.publicKey(), '1');
  const transaction = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: destination.publicKey(),
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(300)
    .build();

  return { source, transaction };
}

function signedPayloadKey(keypair: Keypair, payload: Uint8Array): string {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  return StrKey.encodeSignedPayload(Buffer.concat([
    keypair.rawPublicKey(),
    length,
    Buffer.from(payload),
  ]));
}

test('matches an Ed25519 envelope signature and its weight', () => {
  const { source, transaction } = paymentTransaction();
  transaction.sign(source);

  const analysis = analyzeEnvelopeSignatures(
    transaction.toXdr(),
    'testnet',
    [{ key: source.publicKey(), type: 'ed25519_public_key', weight: 2 }],
  );

  assert.equal(analysis.signatureCount, 1);
  assert.equal(analysis.matchedWeight, 2);
  assert.equal(analysis.matchedSigners[0]?.signerKey, source.publicKey());
  assert.deepEqual(analysis.unmatchedSignatureIndexes, []);
});

test('does not accept a signature from a different Ed25519 key', () => {
  const { source, transaction } = paymentTransaction();
  transaction.sign(source);
  const other = Keypair.random();

  const analysis = analyzeEnvelopeSignatures(
    transaction.toXdr(),
    'testnet',
    [{ key: other.publicKey(), type: 'ed25519_public_key', weight: 1 }],
  );

  assert.equal(analysis.matchedWeight, 0);
  assert.deepEqual(analysis.unmatchedSignatureIndexes, [0]);
});

test('matches a Hash(x) signer', () => {
  const { transaction } = paymentTransaction();
  const preimage = Buffer.alloc(32, 7);
  transaction.signHashX(preimage);
  const signerKey = StrKey.encodeSha256Hash(hash(preimage));

  const analysis = analyzeEnvelopeSignatures(
    transaction.toXdr(),
    'testnet',
    [{ key: signerKey, type: 'sha256_hash', weight: 3 }],
  );

  assert.equal(analysis.matchedWeight, 3);
  assert.equal(analysis.matchedSigners[0]?.signerKey, signerKey);
  assert.deepEqual(analysis.unmatchedSignatureIndexes, []);
});

test('recognizes a matching pre-authorized transaction signer without a decorated signature', () => {
  const { transaction } = paymentTransaction();
  const preauthSigner = StrKey.encodePreAuthTx(transaction.hash());

  const analysis = analyzeEnvelopeSignatures(
    transaction.toXdr(),
    'testnet',
    [{ key: preauthSigner, type: 'preauth_tx', weight: 3 }],
  );

  assert.equal(analysis.signatureCount, 0);
  assert.equal(analysis.matchedWeight, 3);
  assert.equal(analysis.matchedSigners[0]?.automatic, true);
});

test('matches Ed25519 and signed-payload signer types with their decorated hints', () => {
  const { source, transaction } = paymentTransaction();
  const payload = transaction.hash();
  const payloadSigner = signedPayloadKey(source, payload);

  // The raw Ed25519 signature is identical because both sign the transaction hash,
  // but CAP-40 gives the signed-payload signer a different decorated-signature hint.
  transaction.sign(source);
  transaction.addDecoratedSignature(source.signPayloadDecorated(payload));

  const analysis = analyzeEnvelopeSignatures(
    transaction.toXdr(),
    'testnet',
    [
      { key: source.publicKey(), type: 'ed25519_public_key', weight: 1 },
      { key: payloadSigner, type: 'ed25519_signed_payload', weight: 2 },
    ],
  );

  assert.equal(analysis.matchedWeight, 3);
  assert.equal(analysis.matchedSigners.length, 2);
  assert.deepEqual(analysis.matchedSigners.map((signer) => signer.signatureIndex), [0, 1]);
  assert.deepEqual(analysis.unmatchedSignatureIndexes, []);
});

test('keeps fee-bump inner and outer signature scopes separate', () => {
  const { source, transaction } = paymentTransaction();
  const feeSource = Keypair.random();
  transaction.sign(source);

  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    feeSource,
    '100',
    transaction,
    Networks.TESTNET,
  );
  feeBump.sign(feeSource);

  const inner = analyzeEnvelopeSignatures(
    feeBump.toXdr(),
    'testnet',
    [{ key: source.publicKey(), type: 'ed25519_public_key', weight: 1 }],
    'inner',
  );
  const outer = analyzeEnvelopeSignatures(
    feeBump.toXdr(),
    'testnet',
    [{ key: feeSource.publicKey(), type: 'ed25519_public_key', weight: 1 }],
    'outer',
  );

  assert.equal(inner.signatureCount, 1);
  assert.equal(inner.matchedWeight, 1);
  assert.equal(outer.signatureCount, 1);
  assert.equal(outer.matchedWeight, 1);
});

test('rejects outer scope on a non fee-bump transaction', () => {
  const { transaction } = paymentTransaction();
  assert.throws(
    () => analyzeEnvelopeSignatures(transaction.toXdr(), 'testnet', [], 'outer'),
    /fee-bump/i,
  );
});
