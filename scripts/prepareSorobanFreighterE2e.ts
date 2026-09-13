import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk/base';
import { writeFile } from 'node:fs/promises';
import { loadAccount, submitTransactionXdr } from '../src/stellar/horizon';

const network = 'testnet' as const;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assertSigner(address: string, label: string) {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new Error(`${label} must be a Stellar G address.`);
  }
}
async function fundTestnetAccount(address: string) {
  const response = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`Friendbot failed for ${address}: HTTP ${response.status}.`);
}

async function configureAccount(account: Keypair, operations: ReturnType<typeof Operation.setOptions>[]) {
  const snapshot = await loadAccount(account.publicKey(), network);
  const builder = new TransactionBuilder(new Account(snapshot.accountId, snapshot.sequence), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  });
  for (const operation of operations) builder.addOperation(operation);
  const transaction = builder.setTimeout(120).build();
  transaction.sign(account);
  await submitTransactionXdr(transaction.toXdr(), network);
}

async function run() {
  const signerA = requiredEnv('MST_E2E_SIGNER_A');
  const signerB = requiredEnv('MST_E2E_SIGNER_B');
  const contractId = requiredEnv('MST_E2E_CONTRACT_ID');
  assertSigner(signerA, 'MST_E2E_SIGNER_A');
  assertSigner(signerB, 'MST_E2E_SIGNER_B');
  if (signerA === signerB) throw new Error('Signer A and signer B must be different wallets.');
  const marker = Number(process.env.MST_E2E_MARKER ?? Date.now() % 1_000_000_000);
  if (!Number.isInteger(marker) || marker < 0 || marker > 0xffffffff) {
    throw new Error('MST_E2E_MARKER must be a valid u32.');
  }
  const output = process.env.MST_E2E_XDR_OUT?.trim() || '/tmp/multisigtools-soroban-freighter.xdr';
  const source = Keypair.random();
  const authorizer = Keypair.random();

  await Promise.all([
    fundTestnetAccount(source.publicKey()),
    fundTestnetAccount(authorizer.publicKey()),
  ]);
  await configureAccount(authorizer, [
    Operation.setOptions({ signer: { ed25519PublicKey: signerA, weight: 1 } }),
    Operation.setOptions({ signer: { ed25519PublicKey: signerB, weight: 1 } }),
    Operation.setOptions({
      masterWeight: 0,
      lowThreshold: 2,
      medThreshold: 2,
      highThreshold: 2,
    }),
  ]);
  await configureAccount(source, [
    Operation.setOptions({ signer: { ed25519PublicKey: signerA, weight: 1 } }),
    Operation.setOptions({
      masterWeight: 0,
      lowThreshold: 1,
      medThreshold: 1,
      highThreshold: 1,
    }),
  ]);

  const sourceSnapshot = await loadAccount(source.publicKey(), network);
  const authorizerSnapshot = await loadAccount(authorizer.publicKey(), network);
  const contract = new Contract(contractId);
  const transaction = new TransactionBuilder(
    new Account(sourceSnapshot.accountId, sourceSnapshot.sequence),
    { fee: BASE_FEE, networkPassphrase: Networks.TESTNET },
  )
    .addOperation(contract.call(
      'authorize',
      nativeToScVal(authorizer.publicKey(), { type: 'address' }),
      nativeToScVal(marker, { type: 'u32' }),
    ))
    .setTimeout(600)
    .build();
  await writeFile(output, `${transaction.toXdr()}\n`);
  console.log(JSON.stringify({
    source: source.publicKey(),
    authorizer: authorizer.publicKey(),
    signerA,
    signerB,
    marker,
    contract: contractId,
    output,
    authorizerThresholds: authorizerSnapshot.thresholds,
    authorizerSigners: authorizerSnapshot.signers.map(({ key, weight }) => ({ key, weight })),
    sourceThresholds: sourceSnapshot.thresholds,
    sourceSigners: sourceSnapshot.signers.map(({ key, weight }) => ({ key, weight })),
  }, null, 2));
}

await run();
