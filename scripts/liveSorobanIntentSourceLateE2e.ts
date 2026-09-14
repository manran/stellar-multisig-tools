import {
  Account,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  Networks,
  TransactionBuilder,
  hash,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import { loadAccount, loadNetworkParameters, submitTransactionXdr } from '../src/stellar/horizon';
import {
  analyzeSorobanGAccountAuthorization,
  mergeSorobanGAccountSignature,
  sorobanAuthorizationPreimageXdr,
} from '../src/stellar/sorobanAuthorization';
import { createSorobanAuthorizationPlan } from '../src/stellar/sorobanAuthorizationPlan';
import { createSorobanIntent, materializeSorobanIntent } from '../src/stellar/sorobanIntent';
import { prepareEnforcedSorobanTransaction, simulateSorobanTransaction } from '../src/stellar/sorobanRpc';

const network = 'testnet' as const;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function fund(address: string) {
  const response = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`Friendbot failed with HTTP ${response.status}.`);
}

function invokeOperation(contract: Contract, actor: string, marker: number) {
  return contract.call(
    'authorize',
    nativeToScVal(actor, { type: 'address' }),
    nativeToScVal(marker, { type: 'u32' }),
  );
}

function authEntriesFromXdr(envelopeXdr: string) {
  const parsed = TransactionBuilder.fromXdr(envelopeXdr, Networks.TESTNET);
  if (parsed instanceof FeeBumpTransaction) throw new Error('Unexpected fee-bump transaction.');
  const operation = parsed.operations[0];
  assert(operation?.type === 'invokeHostFunction', 'Expected one InvokeHostFunction operation.');
  return [...(operation.auth ?? [])];
}

async function run() {
  const contractId = requiredEnv('MST_E2E_CONTRACT_ID');
  const planningSource = Keypair.random();
  const executionSource = Keypair.random();
  const actor = Keypair.random();
  await Promise.all([
    fund(planningSource.publicKey()),
    fund(executionSource.publicKey()),
    fund(actor.publicKey()),
  ]);

  const marker = Number(Date.now() % 1_000_000_000);
  const contract = new Contract(contractId);
  const planningAccount = await loadAccount(planningSource.publicKey(), network);
  const rawPlanningTx = new TransactionBuilder(
    new Account(planningAccount.accountId, planningAccount.sequence),
    { fee: BASE_FEE, networkPassphrase: Networks.TESTNET },
  )
    .addOperation(invokeOperation(contract, actor.publicKey(), marker))
    .setTimeout(180)
    .build();

  const rawOperation = rawPlanningTx.operations[0];
  assert(rawOperation?.type === 'invokeHostFunction', 'Planning transaction is not a contract call.');
  const intent = createSorobanIntent(network, rawOperation.func);

  const recorded = await simulateSorobanTransaction({
    envelopeXdr: rawPlanningTx.toXdr(),
    network,
  });
  assert(recorded.assembledXdr, 'Recording simulation did not assemble the planning transaction.');
  const plan = createSorobanAuthorizationPlan(intent, recorded.assembledXdr);
  assert(plan.executionBinding === 'detached', 'Live fixture unexpectedly produced source-bound authorization.');
  assert(plan.authorizationEntriesXdr.length > 0, 'Recording simulation returned no authorization entries.');

  const actorInspection = recorded.authorizationEntries.find((entry) => entry.authorizer === actor.publicKey());
  assert(actorInspection, 'Recording simulation did not discover the actor authorization.');
  assert(!actorInspection.sourceAccountAuthorization, 'Actor authorization unexpectedly used SOURCE_ACCOUNT.');

  const parameters = await loadNetworkParameters(network);
  const expirationLedger = parameters.ledgerSequence + 120;
  const preimageXdr = sorobanAuthorizationPreimageXdr({
    envelopeXdr: recorded.assembledXdr,
    network,
    entryIndex: actorInspection.index,
    expirationLedger,
  });
  const preimage = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
  const signatureBase64 = Buffer.from(actor.sign(hash(preimage.toXdr()))).toString('base64');
  const authorizedPlanningXdr = await mergeSorobanGAccountSignature({
    envelopeXdr: recorded.assembledXdr,
    network,
    entryIndex: actorInspection.index,
    signerPublicKey: actor.publicKey(),
    signatureBase64,
    expirationLedger,
  });

  const signedEntries = authEntriesFromXdr(authorizedPlanningXdr);
  const executionAccount = await loadAccount(executionSource.publicKey(), network);
  const lateBound = materializeSorobanIntent({
    intent,
    sourceAccount: executionAccount.accountId,
    sourceSequence: executionAccount.sequence,
    fee: BASE_FEE,
    lifetimeSeconds: 180,
    authorizationEntries: signedEntries,
  });

  assert(lateBound.source === executionSource.publicKey(), 'Execution source was not late-bound.');
  assert(lateBound.source !== planningSource.publicKey(), 'Execution source unexpectedly matches planning source.');

  const auth = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: lateBound.toXdr(),
    network,
    currentLedger: parameters.ledgerSequence,
    accountLoader: loadAccount,
  });
  assert(auth.supported && auth.ready && !auth.expired, 'Detached AUTH did not survive late source binding.');

  const enforced = await prepareEnforcedSorobanTransaction({
    envelopeXdr: lateBound.toXdr(),
    network,
  });
  const finalTx = TransactionBuilder.fromXdr(enforced.assembledXdr, Networks.TESTNET);
  if (finalTx instanceof FeeBumpTransaction) throw new Error('Unexpected fee-bump final transaction.');
  assert(finalTx.source === executionSource.publicKey(), 'Enforced transaction changed the late-bound source.');
  finalTx.sign(executionSource);

  const submitted = await submitTransactionXdr(finalTx.toXdr(), network);
  assert(submitted.successful, 'Late-bound execution transaction did not succeed.');

  const refreshedExecution = await loadAccount(executionSource.publicKey(), network);
  const readback = new TransactionBuilder(
    new Account(refreshedExecution.accountId, refreshedExecution.sequence),
    { fee: BASE_FEE, networkPassphrase: Networks.TESTNET },
  )
    .addOperation(contract.call('last'))
    .setTimeout(180)
    .build();
  const state = await simulateSorobanTransaction({ envelopeXdr: readback.toXdr(), network });
  assert(state.returnValuePreview?.includes(actor.publicKey()), 'Contract state did not retain the detached authorizer.');
  assert(state.returnValuePreview?.includes(String(marker)), 'Contract state did not retain the marker.');

  console.log(`Intent ${intent.intentDigest}`);
  console.log(`Authorization plan ${plan.authorizationPlanDigest}`);
  console.log(`Planning source ${planningSource.publicKey()}`);
  console.log(`Execution source ${executionSource.publicKey()}`);
  console.log(`Submitted ${submitted.hash} in ledger ${submitted.ledger}.`);
  console.log(`Contract state ${state.returnValuePreview}.`);
  console.log('LIVE SOROBAN INTENT SOURCE-LATE E2E PASSED');
}

await run();
