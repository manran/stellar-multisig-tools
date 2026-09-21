import {
  Account,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { blobSigningRequestStore } from '../apps/stellar-api/stellar/server/blobRequestStore';
import {
  contributeSigningRequest,
  createSigningRequest,
  getSigningRequest,
  submitSigningRequest,
} from '../apps/stellar-api/stellar/server/requestService';
import { loadAccount, loadNetworkParameters } from '../src/stellar/horizon';

const network = 'testnet' as const;
const horizonUrl = 'https://horizon-testnet.stellar.org';
const serviceOptions = { accountLoader: loadAccount, networkParametersLoader: loadNetworkParameters };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Expected JSON from ${response.url}, received: ${text.slice(0, 300)}`);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`Expected an object response from ${response.url}.`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${response.url}: ${text.slice(0, 1000)}`);
  }
  return body as Record<string, unknown>;
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  return readJson(await fetch(url, init));
}

async function loadRawAccount(accountId: string): Promise<Record<string, unknown>> {
  return fetchJson(`${horizonUrl}/accounts/${encodeURIComponent(accountId)}`);
}

async function submitXdr(xdr: string): Promise<Record<string, unknown>> {
  return fetchJson(`${horizonUrl}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx: xdr }).toString(),
  });
}

async function submitOperation(source: Keypair, operation: ReturnType<typeof Operation.setOptions>) {
  const account = await loadRawAccount(source.publicKey());
  assert(typeof account.account_id === 'string', 'Horizon account response is missing account_id.');
  assert(typeof account.sequence === 'string', 'Horizon account response is missing sequence.');

  const transaction = new TransactionBuilder(new Account(account.account_id, account.sequence), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(120)
    .build();
  transaction.sign(source);
  await submitXdr(transaction.toXdr());
}

async function run() {
  if (process.env.VERCEL !== '1') {
    console.log('Skipping live Request E2E outside a Vercel build.');
    return;
  }
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'preview') {
    console.log(`Skipping live Request E2E in Vercel ${process.env.VERCEL_ENV}.`);
    return;
  }

  const tokenConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const oidcConfigured = Boolean(process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN);
  assert(tokenConfigured || oidcConfigured, 'Private Blob credentials are not available in this Vercel preview build.');
  console.log(`Private Blob credentials detected (${tokenConfigured ? 'token' : 'OIDC'} mode).`);

  const source = Keypair.random();
  const signerB = Keypair.random();
  const signerC = Keypair.random();

  await fetchJson(`https://friendbot.stellar.org/?addr=${encodeURIComponent(source.publicKey())}`);
  console.log(`Funded Testnet account ${source.publicKey()}.`);

  await submitOperation(source, Operation.setOptions({
    signer: { ed25519PublicKey: signerB.publicKey(), weight: 1 },
  }));
  await submitOperation(source, Operation.setOptions({
    signer: { ed25519PublicKey: signerC.publicKey(), weight: 1 },
  }));
  await submitOperation(source, Operation.setOptions({
    masterWeight: 1,
    lowThreshold: 2,
    medThreshold: 2,
    highThreshold: 2,
  }));

  const configured = await loadAccount(source.publicKey(), network);
  assert(configured.thresholds.low === 2, 'Low threshold was not configured to 2.');
  assert(configured.thresholds.medium === 2, 'Medium threshold was not configured to 2.');
  assert(configured.thresholds.high === 2, 'High threshold was not configured to 2.');
  assert(configured.signers.some((signer) => signer.key === signerB.publicKey() && signer.weight === 1), 'Signer B is missing.');
  assert(configured.signers.some((signer) => signer.key === signerC.publicKey() && signer.weight === 1), 'Signer C is missing.');
  console.log('Configured a real 2-of-3 weighted Stellar account.');

  const transaction = new TransactionBuilder(new Account(configured.accountId, configured.sequence), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({
      name: `multisig_tools_e2e_${Date.now()}`,
      value: 'request-flow',
    }))
    .setTimeout(600)
    .build();
  const baseXdr = transaction.toXdr();

  const signedByB = TransactionBuilder.fromXdr(baseXdr, Networks.TESTNET);
  signedByB.sign(signerB);
  const signedByC = TransactionBuilder.fromXdr(baseXdr, Networks.TESTNET);
  signedByC.sign(signerC);

  const created = await createSigningRequest(blobSigningRequestStore, { network, xdr: baseXdr }, serviceOptions);
  assert(created.signatureCount === 0, 'New Blob-backed Request should start unsigned.');
  assert(created.status === 'awaiting_signatures', `Expected waiting status, got ${created.status}.`);
  console.log(`Created Blob-backed Request ${created.id}.`);

  const loaded = await getSigningRequest(blobSigningRequestStore, created.id, serviceOptions);
  assert(loaded.transactionHash === created.transactionHash, 'Stored Request transaction hash changed after reload.');
  assert(loaded.signatureCount === 0, 'Stored Request unexpectedly contains signatures.');
  console.log('Reloaded Request from private Blob.');

  const first = await contributeSigningRequest(blobSigningRequestStore, created.id, signedByB.toXdr(), serviceOptions);
  assert(first.addedSignatureCount === 1, 'Signer B contribution did not add exactly one signature.');
  assert(first.request.signatureCount === 1, 'Request should contain one signature after signer B.');
  assert(first.request.status === 'awaiting_signatures', `Expected waiting status after signer B, got ${first.request.status}.`);
  console.log('Accepted signer B contribution.');

  const duplicate = await contributeSigningRequest(blobSigningRequestStore, created.id, signedByB.toXdr(), serviceOptions);
  assert(duplicate.addedSignatureCount === 0, 'Repeated signer B contribution should be idempotent.');
  assert(duplicate.request.signatureCount === 1, 'Repeated contribution changed signature count.');
  console.log('Repeated signer B contribution remained idempotent.');

  const second = await contributeSigningRequest(blobSigningRequestStore, created.id, signedByC.toXdr(), serviceOptions);
  assert(second.addedSignatureCount === 1, 'Signer C contribution did not add exactly one signature.');
  assert(second.request.signatureCount === 2, 'Request should contain two signatures after signer C.');
  assert(second.request.contributionCount === 2, 'Request should contain two unique signature contributions.');
  assert(second.request.status === 'ready', `Expected ready status after signer C, got ${second.request.status}.`);
  console.log('Accepted signer C contribution; Request is ready.');

  const submitted = await submitSigningRequest(blobSigningRequestStore, created.id, serviceOptions);
  assert(submitted.status === 'submitted', `Expected submitted status, got ${submitted.status}.`);
  assert(submitted.submission?.transactionHash === created.transactionHash, 'Submission hash does not match the Request transaction hash.');
  assert(typeof submitted.submission?.ledger === 'number', 'Submission ledger was not recorded.');
  console.log(`Request service submitted the merged XDR in ledger ${submitted.submission.ledger}.`);

  const reloadedSubmitted = await getSigningRequest(blobSigningRequestStore, created.id, serviceOptions);
  assert(reloadedSubmitted.status === 'submitted', 'Submitted lifecycle state was not persisted in private Blob.');
  assert(reloadedSubmitted.submission?.ledger === submitted.submission.ledger, 'Persisted submission ledger changed after reload.');

  const idempotentSubmit = await submitSigningRequest(blobSigningRequestStore, created.id, serviceOptions);
  assert(idempotentSubmit.status === 'submitted', 'Repeated submit should remain idempotently submitted.');
  assert(idempotentSubmit.submission?.ledger === submitted.submission.ledger, 'Repeated submit changed the stored result.');
  console.log('Submission lifecycle persisted and repeated submit remained idempotent.');
  console.log('LIVE BLOB REQUEST E2E PASSED');
}

await run();
