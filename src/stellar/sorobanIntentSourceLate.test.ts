import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Address,
  Contract,
  FeeBumpTransaction,
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
} from './sorobanAuthorization.js';
import type { StellarAccountSnapshot } from './types.js';
function snapshot(
  accountId: string,
  signers: Array<{ key: string; weight: number }>,
  medium: number,
): StellarAccountSnapshot {
  return {
    accountId,
    sequence: '1',
    subentryCount: signers.length,
    numSponsoring: 0,
    numSponsored: 0,
    thresholds: { low: 1, medium, high: medium },
    signers: signers.map((signer) => ({ ...signer, type: 'ed25519_public_key' })),
  };
}

function invocationFor(authorizer: string) {
  const contract = new Contract('CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE');
  const args = new xdr.InvokeContractArgs({
    contractAddress: contract.address().toScAddress(),
    functionName: 'approve_invoice',
    args: [nativeToScVal(authorizer), nativeToScVal('invoice-42')],
  });
  return { args, func: xdr.HostFunction.hostFunctionTypeInvokeContract(args) };
}
function detachedAuthorization(authorizer: string, args: xdr.InvokeContractArgs) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
      address: new Address(authorizer).toScAddress(),
      nonce: xdr.Int64(42n),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
      subInvocations: [],
    }),
  });
}

function transactionFor(
  source: Keypair,
  sequence: string,
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[],
) {
  return new TransactionBuilder(new Account(source.publicKey(), sequence), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({ func, auth }))
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(3600)
    .build();
}

function signatureFor(
  envelopeXdr: string,
  entryIndex: number,
  expirationLedger: number,
  signer: Keypair,
) {
  const preimageXdr = sorobanAuthorizationPreimageXdr({
    envelopeXdr,
    network: 'testnet',
    entryIndex,
    expirationLedger,
  });
  const preimage = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
  return Buffer.from(signer.sign(hash(preimage.toXdr()))).toString('base64');
}
test('detached Soroban AUTH survives changing the transaction source', async () => {
  const planningSource = Keypair.random();
  const executionSource = Keypair.random();
  const authorizer = Keypair.random();
  const signerA = Keypair.random();
  const signerB = Keypair.random();
  const { args, func } = invocationFor(authorizer.publicKey());

  const planningTx = transactionFor(
    planningSource,
    '1',
    func,
    [detachedAuthorization(authorizer.publicKey(), args)],
  );
  const initializedXdr = await initializeSorobanGAccountAuthorizationWindow({
    envelopeXdr: planningTx.toXDR(),
    network: 'testnet',
    currentLedger: 100,
    expirationLedgers: 360,
  });
  const expirationLedger = 460;
  const signatureA = signatureFor(initializedXdr, 0, expirationLedger, signerA);
  const withA = await mergeSorobanGAccountSignature({
    envelopeXdr: initializedXdr,
    network: 'testnet',
    entryIndex: 0,
    signerPublicKey: signerA.publicKey(),
    signatureBase64: signatureA,
    expirationLedger,
  });
  const signatureB = signatureFor(initializedXdr, 0, expirationLedger, signerB);
  const authorizedXdr = await mergeSorobanGAccountSignature({
    envelopeXdr: withA,
    network: 'testnet',
    entryIndex: 0,
    signerPublicKey: signerB.publicKey(),
    signatureBase64: signatureB,
    expirationLedger,
  });

  const authorizedTx = TransactionBuilder.fromXDR(authorizedXdr, Networks.TESTNET);
  if (authorizedTx instanceof FeeBumpTransaction) throw new Error('Unexpected fee-bump transaction.');
  const operation = authorizedTx.operations[0];
  assert.equal(operation.type, 'invokeHostFunction');
  if (operation.type !== 'invokeHostFunction') return;
  const rebuilt = transactionFor(
    executionSource,
    '9',
    operation.func,
    [...(operation.auth ?? [])],
  );
  assert.notEqual(rebuilt.source, authorizedTx.source);

  const planningPreimage = sorobanAuthorizationPreimageXdr({
    envelopeXdr: authorizedXdr,
    network: 'testnet',
    entryIndex: 0,
    expirationLedger,
  });
  const executionPreimage = sorobanAuthorizationPreimageXdr({
    envelopeXdr: rebuilt.toXDR(),
    network: 'testnet',
    entryIndex: 0,
    expirationLedger,
  });
  assert.equal(executionPreimage, planningPreimage);

  const authorizerAccount = snapshot(authorizer.publicKey(), [
    { key: signerA.publicKey(), weight: 1 },
    { key: signerB.publicKey(), weight: 1 },
  ], 2);
  const analysis = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: rebuilt.toXDR(),
    network: 'testnet',
    currentLedger: 101,
    accountLoader: async (accountId) => {
      if (accountId === authorizer.publicKey()) return authorizerAccount;
      throw new Error(`unexpected account ${accountId}`);
    },
  });

  assert.equal(analysis.supported, true);
  assert.equal(analysis.ready, true);
  assert.equal(analysis.expired, false);
  assert.equal(analysis.authorizers.length, 1);
  assert.equal(analysis.authorizers[0].signedWeight, 2);
  assert.equal(analysis.authorizers[0].threshold, 2);
});
