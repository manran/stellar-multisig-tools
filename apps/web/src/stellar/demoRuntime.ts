import { Account, Asset, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';
import type { StellarAccountSnapshot, StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

export const DEMO_NETWORK: StellarNetwork = 'testnet';
export const DEMO_TREASURY_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
export const DEMO_DESTINATION_ADDRESS = 'GDGV7V7UT3XDMQ3COT25VCQNJDW57WYPHSLFSAJEW2LLZDCDREWNAPXO';

export const DEMO_SIGNERS = [
  { name: 'Alice', address: DEMO_TREASURY_ADDRESS },
  { name: 'Bob', address: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWCF' },
  { name: 'Carol', address: 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCMZX' },
] as const;

export type DemoSignerName = typeof DEMO_SIGNERS[number]['name'];
export type DemoProposalStatus = 'awaiting_signatures' | 'ready' | 'submitted';

export interface DemoPaymentDraft {
  amount: string;
  memo: string;
  privateNote: string;
}

export interface DemoProposal {
  xdr: string;
  signedBy: DemoSignerName[];
  submitted: boolean;
}

export const DEFAULT_DEMO_PAYMENT: DemoPaymentDraft = {
  amount: '250',
  memo: 'Invoice 2048',
  privateNote: 'September infrastructure invoice.',
};

export const DEMO_TREASURY_ACCOUNT: StellarAccountSnapshot = {
  accountId: DEMO_TREASURY_ADDRESS,
  sequence: '123456',
  subentryCount: 2,
  numSponsoring: 0,
  numSponsored: 0,
  nativeBalance: '1000.0000000',
  nativeSellingLiabilities: '0.0000000',
  thresholds: { low: 1, medium: 2, high: 2 },
  signers: DEMO_SIGNERS.map((signer) => ({
    key: signer.address,
    type: 'ed25519_public_key',
    weight: 1,
  })),
};

function validAmount(value: string) {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value) && Number(value) > 0;
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).length;
}

export function validateDemoPayment(draft: DemoPaymentDraft): string {
  if (!validAmount(draft.amount.trim())) return 'Enter an amount greater than 0 with up to 7 decimal places.';
  if (utf8Bytes(draft.memo.trim()) > 28) return 'Stellar text memos are limited to 28 UTF-8 bytes.';
  return '';
}

export function buildDemoPaymentXdr(draft: DemoPaymentDraft): string {
  const validation = validateDemoPayment(draft);
  if (validation) throw new Error(validation);

  let builder = new TransactionBuilder(new Account(DEMO_TREASURY_ADDRESS, DEMO_TREASURY_ACCOUNT.sequence), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  }).addOperation(Operation.payment({
    destination: DEMO_DESTINATION_ADDRESS,
    asset: Asset.native(),
    amount: draft.amount.trim(),
  }));

  const memo = draft.memo.trim();
  if (memo) builder = builder.addMemo(Memo.text(memo));
  return builder.setTimeout(3600).build().toXDR();
}

export function demoPaymentInspection(draft: DemoPaymentDraft) {
  return inspectTransactionXdr(buildDemoPaymentXdr(draft), DEMO_NETWORK);
}

export function createDemoProposalFromXdr(xdr: string): DemoProposal {
  inspectTransactionXdr(xdr, DEMO_NETWORK);
  return { xdr, signedBy: [], submitted: false };
}

export function createDemoProposal(draft: DemoPaymentDraft): DemoProposal {
  return createDemoProposalFromXdr(buildDemoPaymentXdr(draft));
}

export function demoProposalStatus(proposal: DemoProposal): DemoProposalStatus {
  if (proposal.submitted) return 'submitted';
  return proposal.signedBy.length >= 2 ? 'ready' : 'awaiting_signatures';
}

export function signDemoProposal(proposal: DemoProposal, signer: DemoSignerName): DemoProposal {
  if (proposal.submitted || proposal.signedBy.includes(signer)) return proposal;
  if (!DEMO_SIGNERS.some((candidate) => candidate.name === signer)) return proposal;
  return { ...proposal, signedBy: [...proposal.signedBy, signer] };
}

export function submitDemoProposal(proposal: DemoProposal): DemoProposal {
  if (demoProposalStatus(proposal) !== 'ready') throw new Error('The Demo proposal needs two approvals before submission.');
  return { ...proposal, submitted: true };
}
