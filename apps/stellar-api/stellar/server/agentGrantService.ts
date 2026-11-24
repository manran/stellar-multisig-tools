import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
} from '@stellar/stellar-sdk/base';
import type { AgentAccessLevel, SignerPrincipalRef } from '../../../../packages/stellar-core/src/agentAccessTypes.js';
import type { AgentCredentialStore } from './agentCredentialStore.js';
import { createSignerAgentCredential } from './agentCredentialService.js';

const TTL_MS = 10 * 60 * 1000;
const MESSAGE_PREFIX = Buffer.from('Stellar Signed Message:\n', 'utf8');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class AgentGrantError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'AgentGrantError';
  }
}

export interface AgentGrantRequest {
  version: 1;
  id: string;
  codeHash: string;
  userCode: string;
  label: string;
  access: AgentAccessLevel;
  network: 'testnet';
  createdAt: string;
  expiresAt: string;
}

export type AgentGrantDecision =
  | { status: 'approved'; principal: SignerPrincipalRef; decidedAt: string }
  | { status: 'denied'; decidedAt: string };

export interface AgentGrantStore {
  create(request: AgentGrantRequest): Promise<void>;
  get(id: string): Promise<AgentGrantRequest | null>;
  decision(id: string): Promise<AgentGrantDecision | null>;
  decide(id: string, result: AgentGrantDecision): Promise<boolean>;
  claim(id: string): Promise<boolean>;
}

function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
function deviceSecret(code: string) {
  const match = /^mgd_([a-f0-9]{32})_([A-Za-z0-9_-]{43})$/.exec(code);
  if (!match) throw new AgentGrantError('Invalid Agent pairing secret.', 401, 'invalid_device_code');
  return { id: match[1], secret: match[2] };
}
function validId(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new AgentGrantError('Invalid Agent pairing request.', 400, 'invalid_grant_id');
  return id;
}
function live(record: AgentGrantRequest, now = new Date()) {
  if (Date.parse(record.expiresAt) <= now.getTime()) {
    throw new AgentGrantError('Agent pairing request expired. Start again.', 410, 'grant_expired');
  }
}
function userCode() {
  return [...randomBytes(8)].map((value) => alphabet[value % alphabet.length]).join('').replace(/^(.{4})/, '$1-');
}
export function grantPreview(grant: AgentGrantRequest, decision: AgentGrantDecision | null) {
  return { requestId: grant.id, userCode: grant.userCode, label: grant.label,
    access: grant.access, network: grant.network, expiresAt: grant.expiresAt,
    status: decision?.status ?? 'pending' };
}

export async function beginAgentGrant(
  store: AgentGrantStore, labelValue: unknown, accessValue: unknown, networkValue: unknown,
  now = new Date(),
) {
  if (networkValue !== 'testnet') throw new AgentGrantError('Agent pairing is available on Testnet only.', 409, 'testnet_only');
  if (typeof labelValue !== 'string' || !labelValue.trim() || labelValue.trim().length > 80 || /[\x00-\x1f]/.test(labelValue)) {
    throw new AgentGrantError('Agent name must be between 1 and 80 visible characters.', 400, 'invalid_agent_name');
  }
  if (accessValue !== 'read' && accessValue !== 'write' && accessValue !== 'sign') {
    throw new AgentGrantError('Access must be Read, Write, or Sign.', 400, 'invalid_agent_access');
  }
  const id = randomBytes(16).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const record: AgentGrantRequest = {
    version: 1, id, codeHash: digest(secret), userCode: userCode(),
    label: labelValue.trim(), access: accessValue, network: 'testnet',
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
  };
  await store.create(record);
  return { ...grantPreview(record, null),
    deviceCode: 'mgd_' + id + '_' + secret,
    verificationUri: 'https://stellar-testnet.multisig.tools/agent-access?grant=' + id,
    intervalSeconds: 5 };
}

export async function inspectAgentGrant(store: AgentGrantStore, id: string, now = new Date()) {
  const grant = await store.get(validId(id));
  if (!grant) throw new AgentGrantError('Agent request not found.', 404, 'grant_not_found');
  live(grant, now);
  return { grant, decision: await store.decision(id) };
}

export function agentApprovalMessage(grant: AgentGrantRequest, principal: SignerPrincipalRef, webAuthDomain: string) {
  if (grant.network !== principal.network) throw new AgentGrantError('Wallet network differs from Agent request.', 409, 'network_mismatch');
  return [
    'MultiSig Tools: Approve Agent API access',
    '',
    'Website: ' + webAuthDomain,
    'Network: Stellar Testnet',
    'Signer: ' + principal.address,
    'Agent: ' + grant.label,
    'Access: ' + grant.access.toUpperCase(),
    'Verification code: ' + grant.userCode,
    'Request: ' + grant.id,
    'Expires: ' + grant.expiresAt,
    '',
    'I authorize this Agent to receive a reusable API credential.',
    'This is not a Stellar transaction or private-key transfer.',
  ].join('\n');
}

export function approvalTransaction(
  grant: AgentGrantRequest,
  principal: SignerPrincipalRef,
  webAuthDomain: string,
  serverKey: Keypair,
) {
  const message = agentApprovalMessage(grant, principal, webAuthDomain);
  const transaction = new TransactionBuilder(new Account(serverKey.publicKey(), '-1'), {
    fee: '100', networkPassphrase: Networks.TESTNET,
  })
    .setTimebounds(0, Math.floor(Date.parse(grant.expiresAt) / 1000))
    .addOperation(Operation.manageData({
      source: principal.address, name: 'agent_access_grant', value: Buffer.from(hash(Buffer.from(message))),
    }))
    .addOperation(Operation.manageData({
      source: serverKey.publicKey(), name: 'web_auth_domain', value: webAuthDomain,
    }))
    .build();
  transaction.sign(serverKey);
  return transaction.toXDR();
}

export function verifyAgentApproval(
  grant: AgentGrantRequest, principal: SignerPrincipalRef, webAuthDomain: string,
  serverKey: Keypair, proof: { mode: 'sep53'; signature: string } | { mode: 'transaction'; transaction: string },
) {
  const message = agentApprovalMessage(grant, principal, webAuthDomain);
  const signer = Keypair.fromPublicKey(principal.address);
  if (proof.mode === 'sep53') {
    const bytes = Buffer.from(proof.signature, 'base64');
    if (bytes.length !== 64 || !signer.verify(hash(Buffer.concat([MESSAGE_PREFIX, Buffer.from(message)])), bytes)) {
      throw new AgentGrantError('Wallet approval signature does not match this Agent request.', 401, 'invalid_approval_signature');
    }
    return;
  }
  let signed;
  try { signed = TransactionBuilder.fromXDR(proof.transaction, Networks.TESTNET); }
  catch { throw new AgentGrantError('Wallet approval XDR is invalid.', 400, 'invalid_approval_xdr'); }
  const expected = TransactionBuilder.fromXDR(approvalTransaction(grant, principal, webAuthDomain, serverKey), Networks.TESTNET);
  if (signed instanceof FeeBumpTransaction || expected instanceof FeeBumpTransaction
    || !Buffer.from(signed.hash()).equals(Buffer.from(expected.hash()))
    || signed.signatures.length !== 2
    || !signed.signatures.some((item) => serverKey.verify(signed.hash(), item.signature.toBytes()))
    || !signed.signatures.some((item) => signer.verify(signed.hash(), item.signature.toBytes()))) {
    throw new AgentGrantError('Wallet approval does not match this Agent request.', 401, 'invalid_approval_signature');
  }
}

export async function decideAgentGrant(
  store: AgentGrantStore, id: string, decision: AgentGrantDecision, now = new Date(),
) {
  const { grant, decision: prior } = await inspectAgentGrant(store, id, now);
  if (prior) throw new AgentGrantError('Agent pairing request was already decided.', 409, 'grant_already_decided');
  if (decision.status === 'approved' && decision.principal.network !== grant.network) {
    throw new AgentGrantError('Wallet network differs from Agent request.', 409, 'network_mismatch');
  }
  if (!await store.decide(id, decision)) throw new AgentGrantError('Agent pairing was already decided.', 409, 'grant_already_decided');
}

export async function pollAgentGrant(
  store: AgentGrantStore, credentials: AgentCredentialStore,
  deviceCode: string, now = new Date(),
) {
  const { id, secret } = deviceSecret(deviceCode);
  const grant = await store.get(id);
  if (!grant) throw new AgentGrantError('Invalid Agent pairing secret.', 401, 'invalid_device_code');
  const a = Buffer.from(digest(secret), 'hex');
  const b = Buffer.from(grant.codeHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AgentGrantError('Invalid Agent pairing secret.', 401, 'invalid_device_code');
  }
  live(grant, now);
  const decision = await store.decision(id);
  if (!decision) return { status: 'authorization_pending' };
  if (decision.status === 'denied') return { status: 'access_denied' };
  if (!await store.claim(id)) throw new AgentGrantError('Pairing credential has already been delivered.', 409, 'already_exchanged');
  const result = await createSignerAgentCredential(credentials, decision.principal, grant.label, grant.access, decision.principal.address, now);
  return { status: 'approved', apiKey: result.apiKey, credential: result.credential };
}
