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
  inspectAuthEntry,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import {
  createSorobanContractAuthorizationChallenge,
  stageSorobanContractCredentialContribution,
} from '../../packages/stellar-core/src/sorobanCustomAuthorization.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
const CONTRACT_ACCOUNT = 'CBUGCD3J6RCTJ5RVK7SGDV63JKV7E5YMULD5HAXQ7BGHNLB5DYVVZIEH';

function preparedContractAccountTransaction() {
  const source = Keypair.random();
  const contract = new Contract(CONTRACT_ID);
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'authorize',
    args: [nativeToScVal(CONTRACT_ACCOUNT), nativeToScVal(301)],
  });  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
  const authorization = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(CONTRACT_ACCOUNT).toScAddress(),
        nonce: xdr.Int64(42n),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
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
      auth: [authorization],
    }))
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(3600)
    .build();
  return { source, transaction };
}

function customCredentialXdr(byte = 7): string {
  return xdr.ScVal.scvBytes(Buffer.alloc(64, byte)).toXdr('base64');
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
test('contract-account challenge binds exact network, authorizer, invocation and expiration', () => {
  const { transaction } = preparedContractAccountTransaction();
  const testnet = createSorobanContractAuthorizationChallenge({
    envelopeXdr: transaction.toXdr(),
    network: 'testnet',
    entryIndex: 0,
    expirationLedger: 500,
  });
  const publicNetwork = createSorobanContractAuthorizationChallenge({
    envelopeXdr: transaction.toXdr(),
    network: 'public',
    entryIndex: 0,
    expirationLedger: 500,
  });

  assert.equal(testnet.version, 1);
  assert.equal(testnet.authorizer, CONTRACT_ACCOUNT);
  assert.equal(testnet.entryIndex, 0);
  assert.equal(testnet.expirationLedger, 500);
  assert.equal(testnet.payloadHashHex.length, 64);
  assert.notEqual(testnet.payloadHashHex, publicNetwork.payloadHashHex);
  assert.doesNotThrow(() => xdr.HashIdPreimage.fromXdr(testnet.preimageXdr, 'base64'));
});

test('opaque contract credential is staged without claiming local policy validity', async () => {
  const { transaction } = preparedContractAccountTransaction();
  const challenge = createSorobanContractAuthorizationChallenge({
    envelopeXdr: transaction.toXdr(),
    network: 'testnet',
    entryIndex: 0,
    expirationLedger: 500,
  });
  const staged = await stageSorobanContractCredentialContribution({
    envelopeXdr: transaction.toXdr(),
    challenge,
    contribution: {
      ...challenge,
      signatureScValXdr: customCredentialXdr(),
    },
  });
  assert.equal(staged.validation, 'requires-rpc-enforce');
  assert.deepEqual(staged.challenge, challenge);
  const parsed = TransactionBuilder.fromXdr(staged.envelopeXdr, Networks.TESTNET);
  assert.equal(parsed.operations[0]?.type, 'invokeHostFunction');
  if (parsed.operations[0]?.type !== 'invokeHostFunction') return;
  const entry = parsed.operations[0].auth?.[0];
  assert.ok(entry);
  const info = inspectAuthEntry(entry);
  assert.equal(info.address, CONTRACT_ACCOUNT);
  assert.equal(info.signed, true);
  assert.equal(info.signatureExpirationLedger, 500);
  assert.equal(info.signers[0]?.signatures, null);
});

test('contract credential staging preserves CLI-style precondNone exactly', async () => {
  const { transaction } = preparedContractAccountTransaction();
  const rawXdr = withPrecondNone(transaction.toXdr());
  const challenge = createSorobanContractAuthorizationChallenge({
    envelopeXdr: rawXdr,
    network: 'testnet',
    entryIndex: 0,
    expirationLedger: 500,
  });
  const staged = await stageSorobanContractCredentialContribution({
    envelopeXdr: rawXdr,
    challenge,
    contribution: { ...challenge, signatureScValXdr: customCredentialXdr() },
  });
  const envelope = xdr.TransactionEnvelope.fromXdr(staged.envelopeXdr, 'base64');
  assert.equal(envelope.type, 'envelopeTypeTx');
  if (envelope.type !== 'envelopeTypeTx') return;
  assert.equal(envelope.value.tx.cond.type, 'precondNone');
  assert.equal(envelope.value.tx.ext.type, 'sorobanData');
});

test('staging rejects a challenge whose network was rewritten after authorization planning', async () => {
  const { transaction } = preparedContractAccountTransaction();
  const challenge = createSorobanContractAuthorizationChallenge({
    envelopeXdr: transaction.toXdr(),
    network: 'testnet',
    entryIndex: 0,
    expirationLedger: 500,
  });
  const rewrittenChallenge = { ...challenge, network: 'public' as const };
  await assert.rejects(
    stageSorobanContractCredentialContribution({
      envelopeXdr: transaction.toXdr(),
      challenge: rewrittenChallenge,
      contribution: {
        ...rewrittenChallenge,
        signatureScValXdr: customCredentialXdr(),
      },
    }),
    /challenge is stale or belongs to a different authorization state/,
  );
});

test('staging rejects credentials bound to another payload or authorizer', async () => {
  const { transaction } = preparedContractAccountTransaction();
  const challenge = createSorobanContractAuthorizationChallenge({
    envelopeXdr: transaction.toXdr(),
    network: 'testnet',
    entryIndex: 0,
    expirationLedger: 500,
  });

  await assert.rejects(
    stageSorobanContractCredentialContribution({
      envelopeXdr: transaction.toXdr(),
      challenge,
      contribution: {
        ...challenge,
        payloadHashHex: '00'.repeat(32),
        signatureScValXdr: customCredentialXdr(),
      },
    }),
    /does not match this exact Soroban authorization payload/,
  );

  await assert.rejects(
    stageSorobanContractCredentialContribution({
      envelopeXdr: transaction.toXdr(),
      challenge,
      contribution: {
        ...challenge,
        authorizer: CONTRACT_ID,
        signatureScValXdr: customCredentialXdr(),
      },
    }),
    /does not answer this exact authorization challenge/,
  );
});
test('staging rejects empty credentials and any mutation after envelope signing begins', async () => {
  const { source, transaction } = preparedContractAccountTransaction();
  const challenge = createSorobanContractAuthorizationChallenge({
    envelopeXdr: transaction.toXdr(),
    network: 'testnet',
    entryIndex: 0,
    expirationLedger: 500,
  });

  await assert.rejects(
    stageSorobanContractCredentialContribution({
      envelopeXdr: transaction.toXdr(),
      challenge,
      contribution: {
        ...challenge,
        signatureScValXdr: xdr.ScVal.scvVoid().toXdr('base64'),
      },
    }),
    /cannot use an empty ScVal payload/,
  );

  transaction.sign(source);
  assert.throws(
    () => createSorobanContractAuthorizationChallenge({
      envelopeXdr: transaction.toXdr(),
      network: 'testnet',
      entryIndex: 0,
      expirationLedger: 500,
    }),
    /before transaction-envelope signatures/,
  );
});

test('a staged custom credential cannot be silently merged or replaced a second time', async () => {
  const { transaction } = preparedContractAccountTransaction();
  const challenge = createSorobanContractAuthorizationChallenge({
    envelopeXdr: transaction.toXdr(),
    network: 'testnet',
    entryIndex: 0,
    expirationLedger: 500,
  });
  const staged = await stageSorobanContractCredentialContribution({
    envelopeXdr: transaction.toXdr(),
    challenge,
    contribution: {
      ...challenge,
      signatureScValXdr: customCredentialXdr(),
    },
  });

  assert.throws(
    () => createSorobanContractAuthorizationChallenge({
      envelopeXdr: staged.envelopeXdr,
      network: 'testnet',
      entryIndex: 0,
      expirationLedger: 500,
    }),
    /already contains credential evidence/,
  );
});
