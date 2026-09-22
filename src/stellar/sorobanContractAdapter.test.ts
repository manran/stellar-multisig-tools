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
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import {
  analyzeKnownSorobanContractAuthorization,
  configuredSimpleEd25519ContractAccountAdapter,
  resolveSimpleEd25519ContractAccountAdapter,
  simpleEd25519ContractCredentialContribution,
} from '../../packages/stellar-core/src/sorobanContractAdapter.js';
import {
  createSorobanContractAuthorizationChallenge,
  stageSorobanContractCredentialContribution,
} from '../../packages/stellar-core/src/sorobanCustomAuthorization.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';
const CONTRACT_ACCOUNT = 'CBUGCD3J6RCTJ5RVK7SGDV63JKV7E5YMULD5HAXQ7BGHNLB5DYVVZIEH';
const OTHER_CONTRACT = 'CCCDIKQCEOIWDSHM3CLUFDXV7Z2KVZINC67GQY2YOTHYIRP27LCV5JWL';

async function withTestnetAdapter<T>(ownerAddress: string, run: () => Promise<T> | T): Promise<T> {
  const keys = [
    'STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT',
    'STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER',
  ] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_CONTRACT = CONTRACT_ACCOUNT;
  process.env.STELLAR_SOROBAN_SIMPLE_ACCOUNT_TESTNET_OWNER = ownerAddress;
  try {
    return await run();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function contractAccountTransaction({
  authorizers = [CONTRACT_ACCOUNT],
  signed = false,
  expirationLedger = 0,
}: {
  authorizers?: string[];
  signed?: boolean;
  expirationLedger?: number;
} = {}) {
  const source = Keypair.random();
  const contract = new Contract(CONTRACT_ID);
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'authorize',
    args: [nativeToScVal(authorizers[0]), nativeToScVal(303)],
  });
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
  const auth = [new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  })];
  for (const authorizer of authorizers) {
    auth.push(new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
        new xdr.SorobanAddressCredentials({
          address: new Address(authorizer).toScAddress(),
          nonce: xdr.Int64(42n),
          signatureExpirationLedger: expirationLedger,
          signature: signed ? xdr.ScVal.scvBytes(Buffer.alloc(64, 7)) : xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: invocation,
    }));
  }
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
      auth,
    }))
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(3600)
    .build();
  return { source, transaction };
}

test('explicit adapter configuration resolves only its exact C-account', async () => {
  const owner = Keypair.random();
  await withTestnetAdapter(owner.publicKey(), () => {
    const configured = configuredSimpleEd25519ContractAccountAdapter('testnet');
    assert.equal(configured?.contractAddress, CONTRACT_ACCOUNT);
    assert.equal(configured?.ownerAddress, owner.publicKey());
    assert.equal(configured?.provenance, 'project-configured');
    assert.equal(resolveSimpleEd25519ContractAccountAdapter('testnet', CONTRACT_ACCOUNT)?.id, 'simple-ed25519-v1');
    assert.equal(resolveSimpleEd25519ContractAccountAdapter('testnet', OTHER_CONTRACT), null);
  });
});

test('configured unsigned C-account is recognized but not ready before credential staging', async () => {
  const owner = Keypair.random();
  await withTestnetAdapter(owner.publicKey(), () => {
    const { transaction } = contractAccountTransaction();
    const status = analyzeKnownSorobanContractAuthorization({
      envelopeXdr: transaction.toXdr(),
      network: 'testnet',
      currentLedger: 100,
    });
    assert.equal(status.supported, true);
    assert.equal(status.ready, false);
    assert.equal(status.expired, false);
    assert.equal(status.authorizer?.entryIndex, 1);
    assert.equal(status.authorizer?.adapter.ownerAddress, owner.publicKey());
  });
});

test('simple adapter stages one 64-byte owner signature as opaque ScVal evidence', async () => {
  const owner = Keypair.random();
  await withTestnetAdapter(owner.publicKey(), async () => {
    const { transaction } = contractAccountTransaction();
    const adapter = configuredSimpleEd25519ContractAccountAdapter('testnet');
    assert.ok(adapter);
    const challenge = createSorobanContractAuthorizationChallenge({
      envelopeXdr: transaction.toXdr(),
      network: 'testnet',
      entryIndex: 1,
      expirationLedger: 500,
    });
    const contribution = simpleEd25519ContractCredentialContribution({
      challenge,
      adapter,
      signerAddress: owner.publicKey(),
      signatureBase64: Buffer.from(owner.sign(Buffer.from(challenge.payloadHashHex, 'hex'))).toString('base64'),
    });
    const signatureScVal = xdr.ScVal.fromXdr(contribution.signatureScValXdr, 'base64');
    assert.equal(signatureScVal.type, 'scvBytes');
    assert.equal(signatureScVal.value.toBytes().length, 64);
    const staged = await stageSorobanContractCredentialContribution({
      envelopeXdr: transaction.toXdr(),
      challenge,
      contribution,
    });
    const status = analyzeKnownSorobanContractAuthorization({
      envelopeXdr: staged.envelopeXdr,
      network: 'testnet',
      currentLedger: 100,
    });
    assert.equal(staged.validation, 'requires-rpc-enforce');
    assert.equal(status.ready, true);
    assert.equal(status.expired, false);
    assert.equal(status.authorizer?.expirationLedger, 500);
  });
});

test('simple adapter rejects another wallet and malformed raw signatures', async () => {
  const owner = Keypair.random();
  const outsider = Keypair.random();
  await withTestnetAdapter(owner.publicKey(), () => {
    const { transaction } = contractAccountTransaction();
    const adapter = configuredSimpleEd25519ContractAccountAdapter('testnet');
    assert.ok(adapter);
    const challenge = createSorobanContractAuthorizationChallenge({
      envelopeXdr: transaction.toXdr(),
      network: 'testnet',
      entryIndex: 1,
      expirationLedger: 500,
    });
    assert.throws(
      () => simpleEd25519ContractCredentialContribution({
        challenge,
        adapter,
        signerAddress: outsider.publicKey(),
        signatureBase64: Buffer.from(owner.sign(Buffer.from(challenge.payloadHashHex, 'hex'))).toString('base64'),
      }),
      /not the configured owner/,
    );
    assert.throws(
      () => simpleEd25519ContractCredentialContribution({
        challenge,
        adapter,
        signerAddress: owner.publicKey(),
        signatureBase64: Buffer.alloc(64, 7).toString('base64'),
      }),
      /does not verify against the configured contract-account owner/,
    );
    assert.throws(
      () => simpleEd25519ContractCredentialContribution({
        challenge,
        adapter,
        signerAddress: owner.publicKey(),
        signatureBase64: Buffer.alloc(63, 7).toString('base64'),
      }),
      /exact 64-byte signature/,
    );
  });
});

test('unknown and multiple contract authorizers remain fail-closed', async () => {
  const owner = Keypair.random();
  await withTestnetAdapter(owner.publicKey(), () => {
    const unknown = contractAccountTransaction({ authorizers: [OTHER_CONTRACT] });
    const unknownStatus = analyzeKnownSorobanContractAuthorization({
      envelopeXdr: unknown.transaction.toXdr(),
      network: 'testnet',
      currentLedger: 100,
    });
    assert.equal(unknownStatus.supported, false);
    assert.match(unknownStatus.reason ?? '', /no explicitly configured authorization adapter/);

    const multiple = contractAccountTransaction({ authorizers: [CONTRACT_ACCOUNT, OTHER_CONTRACT] });
    const multipleStatus = analyzeKnownSorobanContractAuthorization({
      envelopeXdr: multiple.transaction.toXdr(),
      network: 'testnet',
      currentLedger: 100,
    });
    assert.equal(multipleStatus.supported, false);
    assert.match(multipleStatus.reason ?? '', /exactly one detached contract authorizer/);
  });
});

test('configured contract credential expires at its authorization ledger', async () => {
  const owner = Keypair.random();
  await withTestnetAdapter(owner.publicKey(), () => {
    const { transaction } = contractAccountTransaction({ signed: true, expirationLedger: 100 });
    const status = analyzeKnownSorobanContractAuthorization({
      envelopeXdr: transaction.toXdr(),
      network: 'testnet',
      currentLedger: 100,
    });
    assert.equal(status.supported, true);
    assert.equal(status.ready, false);
    assert.equal(status.expired, true);
  });
});
