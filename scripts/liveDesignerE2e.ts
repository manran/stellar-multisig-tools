import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { loadAccount, submitTransactionXdr } from '../packages/stellar-core/src/horizon';
import { assessSetupSource, designExactMultisigPolicy } from '../apps/web/src/stellar/multisigDesigner';
import { buildMultisigSetupXdr } from '../apps/web/src/stellar/multisigSetupXdr';

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
  const master = Keypair.random();
  const signerB = Keypair.random();
  const signerC = Keypair.random();

  await fund(master.publicKey());
  const original = await loadAccount(master.publicKey(), network);
  assert(assessSetupSource(original).supported, 'Fresh Testnet account should support the simple Designer setup path.');

  const design = designExactMultisigPolicy(original, {
    additionalSignerKeys: [signerB.publicKey(), signerC.publicKey()],
    keepMaster: false,
    paymentQuorum: 2,
    adminQuorum: 2,
  });

  const unsignedSetupXdr = buildMultisigSetupXdr(original, network, design);
  const setup = TransactionBuilder.fromXdr(unsignedSetupXdr, Networks.TESTNET);
  setup.sign(master);
  const setupResult = await submitTransactionXdr(setup.toXdr(), network);
  console.log(`Setup accepted: ${setupResult.hash}`);

  const configured = await loadAccount(master.publicKey(), network);
  const masterSigner = configured.signers.find((signer) => signer.key === master.publicKey());
  const bSigner = configured.signers.find((signer) => signer.key === signerB.publicKey());
  const cSigner = configured.signers.find((signer) => signer.key === signerC.publicKey());

  assert(masterSigner?.weight === 0, 'Designer did not disable the master key as requested.');
  assert(bSigner?.weight === 1, 'Signer B was not installed with weight 1.');
  assert(cSigner?.weight === 1, 'Signer C was not installed with weight 1.');
  assert(configured.thresholds.low === 2, 'Low threshold is not 2.');
  assert(configured.thresholds.medium === 2, 'Medium threshold is not 2.');
  assert(configured.thresholds.high === 2, 'High threshold is not 2.');
  console.log('Post-setup account is external 2-of-2 with master weight 0.');

  const proof = new TransactionBuilder(new Account(configured.accountId, configured.sequence), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({
      name: `multisig_designer_${Date.now()}`,
      value: 'external-2-of-2-controls-account',
    }))
    .setTimeout(120)
    .build();
  proof.sign(signerB, signerC);
  const proofResult = await submitTransactionXdr(proof.toXdr(), network);
  console.log(`2-of-2 post-setup transaction accepted: ${proofResult.hash}`);
  console.log('LIVE DESIGNER E2E PASSED');
}

await run();
