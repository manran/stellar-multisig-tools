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
  TimeoutInfinite,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import {
  DEFAULT_STELLAR_RPC_PUBLIC_URL,
  DEFAULT_STELLAR_RPC_TESTNET_URL,
  SorobanSimulationError,
  enforcePreparedSorobanTransaction,
  prepareEnforcedSorobanTransaction,
  simulateSorobanTransaction,
  stellarRpcUrl,
} from './sorobanRpc.js';

const CONTRACT_ID = 'CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE';

function contractCallTransaction(operationCount = 1) {
  const source = Keypair.random();
  const contract = new Contract(CONTRACT_ID);
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'read_invoice',
    args: [nativeToScVal('invoice-42')],
  });
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
    subInvocations: [],
  });
  const sourceAuthorization = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation,
  });
  const builder = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  });
  for (let index = 0; index < operationCount; index += 1) {
    builder.addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
      auth: [sourceAuthorization],
    }));
  }
  return { transaction: builder.setTimeout(TimeoutInfinite).build(), source, sourceAuthorization };
}

test('RPC endpoints have safe defaults and explicit project overrides', () => {
  assert.equal(stellarRpcUrl('public', { public: '' }), DEFAULT_STELLAR_RPC_PUBLIC_URL);
  assert.equal(stellarRpcUrl('testnet', { testnet: '' }), DEFAULT_STELLAR_RPC_TESTNET_URL);
  assert.equal(
    stellarRpcUrl('public', { public: 'https://rpc.example.test/custom' }),
    'https://rpc.example.test/custom',
  );
});

test('recording simulation clears imported AUTH before RPC and decodes review facts', async () => {
  const { transaction, sourceAuthorization } = contractCallTransaction();
  const envelopeXdr = transaction.toXdr();
  const returnValue = nativeToScVal('invoice-42').toXdr('base64');
  const detachedAuthorizer = Keypair.random();
  const detachedAuthorization = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(detachedAuthorizer.publicKey()).toScAddress(),
        nonce: xdr.Int64(99n),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVec([]),
      }),
    ),
    rootInvocation: sourceAuthorization.rootInvocation,
  });
  let requestBody: any = null;
  let requestUrl = '';
  const fetchImpl: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: requestBody.id,
      result: {
        latestLedger: 123456,
        minResourceFee: '9876',
        transactionData: new SorobanDataBuilder().build().toXdr('base64'),
        events: [],
        stateChanges: [],
        cost: { cpuInsns: '111', memBytes: '222' },
        results: [{
          auth: [sourceAuthorization.toXdr('base64'), detachedAuthorization.toXdr('base64')],
          xdr: returnValue,
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await simulateSorobanTransaction({
    envelopeXdr,
    network: 'testnet',
    endpointUrl: 'https://rpc.example.test/',
    fetchImpl,
  });

  assert.equal(requestUrl, 'https://rpc.example.test/');
  assert.equal(requestBody.method, 'simulateTransaction');
  assert.notEqual(requestBody.params.transaction, envelopeXdr);
  const recorded = TransactionBuilder.fromXdr(requestBody.params.transaction, Networks.TESTNET);
  assert.equal(recorded.operations.length, 1);
  assert.equal(recorded.operations[0]?.type, 'invokeHostFunction');
  if (recorded.operations[0]?.type === 'invokeHostFunction') assert.equal(recorded.operations[0].auth?.length, 0);
  assert.equal(requestBody.params.xdrFormat, 'base64');
  assert.equal(requestBody.params.authMode, 'record');
  assert.equal(result.latestLedger, 123456);
  assert.equal(result.minResourceFee, '9876');
  assert.equal(result.returnValuePreview, '"invoice-42"');
  assert.equal(result.authorizationEntries.length, 2);
  assert.equal(result.eventCount, 0);
  assert.equal(result.stateChangeCount, 0);
  assert.equal(result.effects.eventCount, 0);
  assert.equal(result.effects.stateChangeCount, 0);
  assert.equal(result.cpuInstructions, '111');
  assert.equal(result.memoryBytes, '222');
  assert.match(result.transactionHash, /^[0-9a-f]{64}$/);
  assert.ok(result.assembledXdr);
  const assembled = TransactionBuilder.fromXdr(result.assembledXdr, Networks.TESTNET);
  assert.equal(assembled.operations.length, 1);
  assert.equal(assembled.operations[0]?.type, 'invokeHostFunction');
  if (assembled.operations[0]?.type === 'invokeHostFunction') {
    assert.equal(assembled.operations[0].auth?.length, 2);
  }
});

test('CLI-style precondNone Soroban XDR remains precondNone after assembly', async () => {
  const { transaction, sourceAuthorization } = contractCallTransaction();
  const envelope = transaction.toEnvelope();
  assert.equal(envelope.type, 'envelopeTypeTx');
  if (envelope.type !== 'envelopeTypeTx') return;
  const source = envelope.value.tx;
  const withoutPreconditions = new xdr.Transaction({
    sourceAccount: source.sourceAccount,
    fee: source.fee,
    seqNum: source.seqNum,
    cond: xdr.Preconditions.precondNone(),
    memo: source.memo,
    operations: source.operations,
    ext: source.ext,
  });
  const rawXdr = xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({ tx: withoutPreconditions, signatures: [] }),
  ).toXdr('base64');
  const transactionData = new SorobanDataBuilder().setResourceFee('500').build().toXdr('base64');
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    jsonrpc: '2.0',
    result: {
      latestLedger: 123456,
      minResourceFee: '500',
      transactionData,
      results: [{ auth: [sourceAuthorization.toXdr('base64')] }],
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const result = await simulateSorobanTransaction({
    envelopeXdr: rawXdr,
    network: 'testnet',
    endpointUrl: 'https://rpc.example.test/',
    fetchImpl,
  });
  assert.ok(result.assembledXdr);
  const assembledEnvelope = xdr.TransactionEnvelope.fromXdr(result.assembledXdr, 'base64');
  assert.equal(assembledEnvelope.type, 'envelopeTypeTx');
  if (assembledEnvelope.type !== 'envelopeTypeTx') return;
  assert.equal(assembledEnvelope.value.tx.cond.type, 'precondNone');
  assert.equal(assembledEnvelope.value.tx.ext.type, 'sorobanData');
});
test('re-simulation replaces the old resource fee instead of stacking it twice', async () => {
  const { transaction, sourceAuthorization } = contractCallTransaction();
  const previouslyAssembled = TransactionBuilder.cloneFrom(transaction, {
    networkPassphrase: Networks.TESTNET,
    fee: '100',
    sorobanData: new SorobanDataBuilder().setResourceFee('500').build(),
  }).build();
  assert.equal(previouslyAssembled.fee, '600');
  const transactionData = new SorobanDataBuilder()
    .setResourceFee('1000')
    .build()
    .toXdr('base64');
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    jsonrpc: '2.0',
    result: {
      latestLedger: 123456,
      minResourceFee: '1000',
      transactionData,
      results: [{ auth: [sourceAuthorization.toXdr('base64')] }],
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const result = await simulateSorobanTransaction({
    envelopeXdr: previouslyAssembled.toXdr(),
    network: 'testnet',
    endpointUrl: 'https://rpc.example.test/',
    fetchImpl,
  });
  assert.ok(result.assembledXdr);
  const assembled = TransactionBuilder.fromXdr(result.assembledXdr, Networks.TESTNET);
  assert.equal(assembled.fee, '1100');
});

test('enforcing preparation refreshes custom-account resources without changing auth or preconditions', async () => {
  const { transaction } = contractCallTransaction();
  const initial = TransactionBuilder.cloneFrom(transaction, {
    networkPassphrase: Networks.TESTNET,
    fee: '100',
    sorobanData: new SorobanDataBuilder().setResourceFee('500').build(),
  }).build();
  const initialEnvelope = initial.toEnvelope();
  assert.equal(initialEnvelope.type, 'envelopeTypeTx');
  if (initialEnvelope.type !== 'envelopeTypeTx') return;
  const source = initialEnvelope.value.tx;
  const precondNone = new xdr.Transaction({
    sourceAccount: source.sourceAccount,
    fee: source.fee,
    seqNum: source.seqNum,
    cond: xdr.Preconditions.precondNone(),
    memo: source.memo,
    operations: source.operations,
    ext: source.ext,
  });
  const stagedXdr = xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({ tx: precondNone, signatures: [] }),
  ).toXdr('base64');
  const originalAuth = initial.operations[0]?.type === 'invokeHostFunction'
    ? initial.operations[0].auth?.map((entry) => entry.toXdr('base64')) ?? []
    : [];
  let requestBody: any = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      result: {
        latestLedger: 123500,
        minResourceFee: '900',
        transactionData: new SorobanDataBuilder().setResourceFee('900').build().toXdr('base64'),
        results: [{ auth: [] }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const refreshed = await prepareEnforcedSorobanTransaction({
    envelopeXdr: stagedXdr,
    network: 'testnet',
    endpointUrl: 'https://rpc.example.test/',
    fetchImpl,
  });
  assert.equal(requestBody.params.authMode, 'enforce');
  assert.equal(requestBody.params.transaction, stagedXdr);
  const parsed = TransactionBuilder.fromXdr(refreshed.assembledXdr, Networks.TESTNET);
  assert.equal(parsed.fee, '1000');
  const envelope = parsed.toEnvelope();
  assert.equal(envelope.type, 'envelopeTypeTx');
  if (envelope.type === 'envelopeTypeTx') assert.equal(envelope.value.tx.cond.type, 'precondNone');
  assert.equal(parsed.operations[0]?.type, 'invokeHostFunction');
  if (parsed.operations[0]?.type === 'invokeHostFunction') {
    assert.deepEqual(parsed.operations[0].auth?.map((entry) => entry.toXdr('base64')) ?? [], originalAuth);
  }
});

test('enforcing preparation refuses to mutate resources after envelope signing begins', async () => {
  const { transaction, source } = contractCallTransaction();
  const prepared = TransactionBuilder.cloneFrom(transaction, {
    networkPassphrase: Networks.TESTNET,
    sorobanData: new SorobanDataBuilder().setResourceFee('500').build(),
  }).build();
  prepared.sign(source);
  let fetchCalls = 0;
  await assert.rejects(
    prepareEnforcedSorobanTransaction({
      envelopeXdr: prepared.toXdr(),
      network: 'testnet',
      endpointUrl: 'https://rpc.example.test/',
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response('{}');
      },
    }),
    /before transaction-envelope signatures/,
  );
  assert.equal(fetchCalls, 0);
});

test('server freeze verification enforces the exact prepared XDR without recording new auth', async () => {
  const { transaction } = contractCallTransaction();
  const envelopeXdr = TransactionBuilder.cloneFrom(transaction, {
    networkPassphrase: Networks.TESTNET,
    sorobanData: new SorobanDataBuilder().setResourceFee('500').build(),
  }).build().toXdr();
  let requestBody: any = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      result: { latestLedger: 123456, transactionData: new SorobanDataBuilder().build().toXdr('base64') },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const verified = await enforcePreparedSorobanTransaction({
    envelopeXdr,
    network: 'testnet',
    endpointUrl: 'https://rpc.example.test/',
    fetchImpl,
  });
  assert.equal(verified.latestLedger, 123456);
  assert.equal(requestBody.method, 'simulateTransaction');
  assert.equal(requestBody.params.transaction, envelopeXdr);
  assert.equal(requestBody.params.authMode, 'enforce');
});

test('server freeze verification rejects a stale instruction budget before submission', async () => {
  const { transaction } = contractCallTransaction();
  const envelopeXdr = TransactionBuilder.cloneFrom(transaction, {
    networkPassphrase: Networks.TESTNET,
    sorobanData: new SorobanDataBuilder().setResources(100, 100, 100).setResourceFee('500').build(),
  }).build().toXdr();
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    jsonrpc: '2.0',
    result: {
      latestLedger: 123456,
      transactionData: new SorobanDataBuilder().setResources(101, 100, 100).setResourceFee('500').build().toXdr('base64'),
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(
    enforcePreparedSorobanTransaction({
      envelopeXdr,
      network: 'testnet',
      endpointUrl: 'https://rpc.example.test/',
      fetchImpl,
    }),
    (error: unknown) => error instanceof SorobanSimulationError
      && error.kind === 'invalid'
      && /CPU instructions/.test(error.message),
  );
});

test('server freeze verification reports contract authorization failure as invalid', async () => {
  const { transaction } = contractCallTransaction();
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    jsonrpc: '2.0',
    result: { latestLedger: 123456, error: 'HostError: missing authorization' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(
    enforcePreparedSorobanTransaction({
      envelopeXdr: transaction.toXdr(),
      network: 'testnet',
      endpointUrl: 'https://rpc.example.test/',
      fetchImpl,
    }),
    (error: unknown) => error instanceof SorobanSimulationError
      && error.kind === 'invalid'
      && /missing authorization/.test(error.message),
  );
});

test('a simulation execution error is distinct from provider unavailability', async () => {
  const { transaction } = contractCallTransaction();
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    jsonrpc: '2.0',
    result: { latestLedger: 456, error: 'HostError: contract rejected the call' },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  await assert.rejects(
    simulateSorobanTransaction({
      envelopeXdr: transaction.toXdr(),
      network: 'testnet',
      endpointUrl: 'https://rpc.example.test/',
      fetchImpl,
    }),
    (error: unknown) => error instanceof SorobanSimulationError
      && error.kind === 'invalid'
      && /contract rejected/.test(error.message),
  );
});

test('provider failure does not become transaction-invalid evidence', async () => {
  const { transaction } = contractCallTransaction();
  const fetchImpl: typeof fetch = async () => {
    throw new TypeError('network down');
  };

  await assert.rejects(
    simulateSorobanTransaction({
      envelopeXdr: transaction.toXdr(),
      network: 'testnet',
      endpointUrl: 'https://rpc.example.test/',
      fetchImpl,
    }),
    (error: unknown) => error instanceof SorobanSimulationError
      && error.kind === 'unavailable'
      && /not been marked invalid/.test(error.message),
  );
});

test('malformed provider result collections fail closed without crashing Review', async () => {
  const { transaction } = contractCallTransaction();
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    jsonrpc: '2.0',
    result: { latestLedger: 789, results: { auth: 'not-an-array' } },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const result = await simulateSorobanTransaction({
    envelopeXdr: transaction.toXdr(),
    network: 'testnet',
    endpointUrl: 'https://rpc.example.test/',
    fetchImpl,
  });

  assert.deepEqual(result.authorizationEntries, []);
  assert.equal(result.returnValuePreview, null);
  assert.equal(result.assembledXdr, null);
});



test('malformed simulation effects fail closed as provider-unavailable evidence', async () => {
  const { transaction } = contractCallTransaction();
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    jsonrpc: '2.0',
    result: { latestLedger: 789, events: ['not-valid-xdr'], stateChanges: [] },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(
    simulateSorobanTransaction({
      envelopeXdr: transaction.toXdr(),
      network: 'testnet',
      endpointUrl: 'https://rpc.example.test/',
      fetchImpl,
    }),
    (error: unknown) => error instanceof SorobanSimulationError
      && error.kind === 'unavailable'
      && /effects.*could not be decoded/i.test(error.message),
  );
});
test('unsupported transaction shapes are rejected before any RPC request', async () => {
  const { transaction } = contractCallTransaction(2);
  let called = false;
  const fetchImpl: typeof fetch = async () => {
    called = true;
    throw new Error('must not fetch');
  };

  await assert.rejects(
    simulateSorobanTransaction({
      envelopeXdr: transaction.toXdr(),
      network: 'testnet',
      endpointUrl: 'https://rpc.example.test/',
      fetchImpl,
    }),
    (error: unknown) => error instanceof SorobanSimulationError
      && error.kind === 'unsupported',
  );
  assert.equal(called, false);
});
