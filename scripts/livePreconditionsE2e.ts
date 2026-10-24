import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { loadAccount, loadNetworkParameters, submitTransactionXdr } from '../packages/stellar-core/src/horizon';
import { assessTransactionPreconditions } from '../packages/stellar-core/src/transactionPreconditions';
import { inspectTransactionXdr } from '../packages/stellar-core/src/transactionXdr';

const network = 'testnet' as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fund(accountId: string) {
  const response = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(accountId)}`);
  if (!response.ok) {
    throw new Error(`Friendbot failed with HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
}

async function run() {
  const source = Keypair.random();
  await fund(source.publicKey());

  const before = await loadAccount(source.publicKey(), network);
  const currentSequence = BigInt(before.sequence);
  const targetSequence = currentSequence + 10n;
  const builderSequence = targetSequence - 1n;

  const transaction = new TransactionBuilder(new Account(before.accountId, builderSequence.toString()), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({
      name: `multisig_preconditions_${Date.now()}`,
      value: 'cap21-relaxed-sequence-gap',
    }))
    .setMinAccountSequence(currentSequence.toString())
    .setTimeout(300)
    .build();
  transaction.sign(source);

  const xdr = transaction.toXdr();
  const inspection = inspectTransactionXdr(xdr, network);
  assert(inspection.sequence === targetSequence.toString(), 'Transaction sequence is not the intended gap target.');
  assert(inspection.minAccountSequence === currentSequence.toString(), 'minAccountSequence was not encoded as intended.');

  const parameters = await loadNetworkParameters(network);
  const assessment = assessTransactionPreconditions(inspection, before, { networkParameters: parameters });
  assert(assessment.readyForSubmit, `Local precondition evaluator rejected a valid CAP-21 gap: ${assessment.checks.map((check) => check.detail).join(' | ')}`);
  console.log(`Evaluator accepted relaxed sequence: ${currentSequence} <= ${before.sequence} < ${targetSequence}.`);

  const result = await submitTransactionXdr(xdr, network);
  console.log(`Stellar accepted relaxed-sequence transaction: ${result.hash}`);

  const after = await loadAccount(source.publicKey(), network);
  assert(after.sequence === targetSequence.toString(), `Expected source sequence ${targetSequence}, got ${after.sequence}.`);
  console.log(`Source sequence jumped from ${currentSequence} to ${after.sequence}.`);
  console.log('LIVE PRECONDITIONS E2E PASSED');
}

await run();
