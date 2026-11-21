import { analyzeEnvelopeSignatures } from '../../../../packages/stellar-core/src/signatureAnalysis.js';
import { inspectTransactionXdr } from '../../../../packages/stellar-core/src/transactionXdr.js';
import { isValidStellarAccountId } from '../../../../packages/stellar-core/src/horizon.js';
import type { SigningRequestSnapshot } from '../../../../packages/stellar-core/src/requestTypes.js';
import { inboxOutgoingSignerProgress } from './inboxRequestPresentation.js';
import type { InboxOutgoingSignerProgress } from './inboxRequestPresentation.js';
import type { InboxRequestSnapshot } from '../../../../packages/stellar-core/src/inboxPresentation.js';

export interface InboxSenderProgress extends InboxOutgoingSignerProgress {
  signature: 'transaction' | 'fee' | 'none' | 'unknown';
  label: string;
  detail: string;
  needsAttention: boolean;
}

/** Signature presence is evidence, not a quorum or a current authorization decision. */
export function inboxSenderProgress(
  request: Pick<SigningRequestSnapshot, 'mergedXdr' | 'network' | 'status'>,
  asked: InboxOutgoingSignerProgress[],
): InboxSenderProgress[] {
  if (!asked.length) return [];
  const signers = asked.filter((item) => isValidStellarAccountId(item.signerAddress))
    .map((item) => ({ key: item.signerAddress, type: 'ed25519_public_key', weight: 1 }));
  let transactionSigners = new Set<string>();
  let feeSigners = new Set<string>();
  let checked = false;
  try {
    transactionSigners = new Set(analyzeEnvelopeSignatures(request.mergedXdr, request.network, signers)
      .matchedSigners.filter((signer) => !signer.automatic).map((signer) => signer.signerKey));
    if (inspectTransactionXdr(request.mergedXdr, request.network).envelopeType === 'fee_bump') {
      feeSigners = new Set(analyzeEnvelopeSignatures(request.mergedXdr, request.network, signers, 'outer')
        .matchedSigners.filter((signer) => !signer.automatic).map((signer) => signer.signerKey));
    }
    checked = true;
  } catch {
    // Keep coordination facts visible if signature evidence cannot be read.
  }

  return asked.map((item): InboxSenderProgress => {
    const signature = !checked ? 'unknown'
      : transactionSigners.has(item.signerAddress) ? 'transaction'
        : feeSigners.has(item.signerAddress) ? 'fee' : 'none';
    if (signature === 'transaction') {
      return { ...item, signature, label: 'Signed', detail: 'Their signature is present in this transaction.', needsAttention: false };
    }
    if (signature === 'fee') {
      return { ...item, signature, label: 'Fee signed', detail: 'Their signature covers the fee envelope. Open the proposal to check the transaction signatures.', needsAttention: false };
    }
    if (signature === 'unknown') {
      return { ...item, signature, label: 'Signature not checked', detail: 'Open the proposal to check its signature status.', needsAttention: true };
    }
    if (request.status !== 'awaiting_signatures') {
      const complete = request.status === 'ready' || request.status === 'waiting_preconditions' || request.status === 'submitted';
      return {
        ...item, signature, label: 'Signature not recorded', needsAttention: false,
        detail: complete ? 'Required authorization is complete. No signature reminder is needed.' : 'Check the proposal status before requesting another signature.',
      };
    }
    if (item.notification?.tone === 'danger') {
      return { ...item, signature, label: 'Email needs attention', detail: 'Check the contact email, then open the proposal to send a reminder.', needsAttention: true };
    }
    return {
      ...item, signature, label: 'Awaiting signature', needsAttention: false,
      detail: item.viewedAt ? 'They opened the proposal with a verified wallet. Their signature is not recorded yet.' : 'No verified view is recorded yet. Open the proposal if you need to send a reminder.',
    };
  }).sort((left, right) => Number(right.needsAttention) - Number(left.needsAttention)
    || Number(left.signature === 'transaction' || left.signature === 'fee') - Number(right.signature === 'transaction' || right.signature === 'fee'));
}

/** The same sender-specific email evidence drives Inbox and Overview attention. */
export function inboxHasFailedSignerEmail(request: InboxRequestSnapshot, viewerAddress: string): boolean {
  return inboxSenderProgress(request, inboxOutgoingSignerProgress(request, viewerAddress))
    .some((item) => item.label === 'Email needs attention');
}
