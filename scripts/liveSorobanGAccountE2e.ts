import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  hash,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk/base';
import {
  contributeSigningRequest,
  createSigningRequest,
  submitSigningRequest,
} from '../apps/api/stellar/server/requestService';
import type {
  SigningRequestStore,
  StoredSignatureContribution,
  StoredSigningRequest,
  StoredSubmissionResult,
} from '../apps/api/stellar/server/requestStore';
import { loadAccount, loadNetworkParameters } from '../src/stellar/horizon';
import {
  analyzeSorobanGAccountAuthorization,
  mergeSorobanGAccountSignature,
  sorobanAuthorizationPreimageXdr,
} from '../src/stellar/sorobanAuthorization';
import {
  enforcePreparedSorobanTransaction,
  simulateSorobanTransaction,
  SorobanSimulationError,
} from '../src/stellar/sorobanRpc';

const network = 'testnet' as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function fundTestnetAccount(address: string) {
  const response = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`Friendbot failed for ${address}: HTTP ${response.status}.`);
}

class MemoryStore implements SigningRequestStore {
  private requests = new Map<string, StoredSigningRequest>();
  private contributions = new Map<string, Map<string, StoredSignatureContribution>>();
  private submissions = new Map<string, StoredSubmissionResult>();

  async createRequest(request: StoredSigningRequest) {
    if (this.requests.has(request.id)) throw new Error('duplicate request');
    this.requests.set(request.id, request);
  }

  async getRequest(id: string) {
    return this.requests.get(id) ?? null;
  }

  async listContributions(id: string) {
    return [...(this.contributions.get(id)?.values() ?? [])];
  }

  async putContribution(id: string, contribution: StoredSignatureContribution) {
    const entries = this.contributions.get(id) ?? new Map<string, StoredSignatureContribution>();
    entries.set(contribution.digest, contribution);
    this.contributions.set(id, entries);
  }

  async getSubmission(id: string, transactionHash: string) {
    const submission = this.submissions.get(id);
    return submission?.transactionHash === transactionHash ? submission : null;
  }

  async putSubmission(id: string, submission: StoredSubmissionResult) {
    this.submissions.set(id, submission);
  }
}

async function sorobanExecutionVerifier(envelopeXdr: string) {
  try {
    await enforcePreparedSorobanTransaction({ envelopeXdr, network });
    return { status: 'verified' as const };
  } catch (cause) {
    if (cause instanceof SorobanSimulationError && cause.kind === 'invalid') {
      return { status: 'invalid' as const, detail: cause.message };
    }
    return {
      status: 'unavailable' as const,
      detail: cause instanceof Error ? cause.message : 'Soroban RPC unavailable.',
    };
  }
}
async function run() {
  const source = Keypair.random();
  const actor = Keypair.random();
  const contractId = requiredEnv('MST_E2E_CONTRACT_ID');
  await Promise.all([
    fundTestnetAccount(source.publicKey()),
    fundTestnetAccount(actor.publicKey()),
  ]);
  const marker = Number(process.env.MST_E2E_MARKER ?? Date.now() % 1_000_000_000);
  assert(Number.isInteger(marker) && marker >= 0 && marker <= 0xffffffff, 'Marker must be u32.');

  const sourceSnapshot = await loadAccount(source.publicKey(), network);
  const contract = new Contract(contractId);
  const raw = new TransactionBuilder(
    new Account(sourceSnapshot.accountId, sourceSnapshot.sequence),
    { fee: BASE_FEE, networkPassphrase: Networks.TESTNET },
  )
    .addOperation(contract.call(
      'authorize',
      nativeToScVal(actor.publicKey(), { type: 'address' }),
      nativeToScVal(marker, { type: 'u32' }),
    ))
    .setTimeout(180)
    .build();

  console.log(`Source ${source.publicKey()}`);
  console.log(`Detached G-account authorizer ${actor.publicKey()}`);
  console.log(`Contract ${contractId}`);
  console.log(`Marker ${marker}`);

  const simulation = await simulateSorobanTransaction({
    envelopeXdr: raw.toXdr(),
    network,
  });
  assert(simulation.assembledXdr, 'Record simulation did not produce an assembled transaction.');
  const actorEntry = simulation.authorizationEntries.find((entry) => entry.authorizer === actor.publicKey());
  assert(actorEntry, 'Simulation did not record the detached actor authorization entry.');
  assert(!actorEntry.sourceAccountAuthorization, 'Actor authorization unexpectedly became source-account authorization.');
  console.log('Recorded detached G-account authorization requirement.');

  const parameters = await loadNetworkParameters(network);
  const expirationLedger = parameters.ledgerSequence + 120;
  const preimageXdr = sorobanAuthorizationPreimageXdr({
    envelopeXdr: simulation.assembledXdr,
    network,
    entryIndex: actorEntry.index,
    expirationLedger,
  });
  const preimage = xdr.HashIdPreimage.fromXdr(preimageXdr, 'base64');
  const signatureBase64 = Buffer.from(actor.sign(hash(preimage.toXdr()))).toString('base64');
  const authorizedXdr = await mergeSorobanGAccountSignature({
    envelopeXdr: simulation.assembledXdr,
    network,
    entryIndex: actorEntry.index,
    signerPublicKey: actor.publicKey(),
    signatureBase64,
    expirationLedger,
  });

  const auth = await analyzeSorobanGAccountAuthorization({
    envelopeXdr: authorizedXdr,
    network,
    currentLedger: parameters.ledgerSequence,
    accountLoader: loadAccount,
  });
  assert(auth.supported && auth.ready && !auth.expired, 'Live G-account authorization did not become ready.');
  await enforcePreparedSorobanTransaction({ envelopeXdr: authorizedXdr, network });
  console.log('Record -> auth-entry signature -> enforce passed.');

  const store = new MemoryStore();
  const serviceOptions = {
    accountLoader: loadAccount,
    networkParametersLoader: loadNetworkParameters,
    sorobanExecutionVerifier,
  };
  const created = await createSigningRequest(
    store,
    { network, xdr: authorizedXdr },
    serviceOptions,
  );
  assert(created.status === 'awaiting_signatures', `Expected awaiting_signatures, got ${created.status}.`);
  console.log(`Proposal ${created.id} frozen after server enforce verification.`);

  const envelope = TransactionBuilder.fromXdr(authorizedXdr, Networks.TESTNET);
  envelope.sign(source);
  const contribution = await contributeSigningRequest(
    store,
    created.id,
    envelope.toXdr(),
    serviceOptions,
  );
  assert(contribution.request.status === 'ready', `Expected ready, got ${contribution.request.status}.`);
  assert(contribution.addedSignatureCount === 1, 'Source envelope signature was not accepted exactly once.');
  console.log('Source envelope signature accepted; Proposal ready.');

  const submitted = await submitSigningRequest(store, created.id, serviceOptions);
  assert(submitted.status === 'submitted', `Expected submitted, got ${submitted.status}.`);
  assert(submitted.submission?.transactionHash === created.transactionHash, 'Submission hash changed.');
  console.log(`Submitted ${created.transactionHash} in ledger ${submitted.submission?.ledger}.`);

  const refreshed = await loadAccount(source.publicKey(), network);
  const readback = new TransactionBuilder(
    new Account(refreshed.accountId, refreshed.sequence),
    { fee: BASE_FEE, networkPassphrase: Networks.TESTNET },
  )
    .addOperation(contract.call('last'))
    .setTimeout(180)
    .build();
  const state = await simulateSorobanTransaction({ envelopeXdr: readback.toXdr(), network });
  assert(state.returnValuePreview?.includes(actor.publicKey()), 'Contract state did not retain the detached authorizer.');
  assert(state.returnValuePreview?.includes(String(marker)), 'Contract state did not retain the marker.');
  console.log(`Contract state readback ${state.returnValuePreview}.`);
  console.log(`LIVE SOROBAN G-ACCOUNT E2E PASSED marker=${marker}`);
}

await run();
