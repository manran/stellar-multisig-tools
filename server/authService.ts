import { randomBytes, randomUUID } from 'node:crypto';
import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
} from '@stellar/stellar-sdk/base';
import type { StellarNetwork } from '../src/stellar/types.js';
import type { AuthStore } from './authStore.js';

const DEFAULT_CHALLENGE_TTL_SECONDS = 5 * 60;
export const DEFAULT_UNLOCK_TTL_SECONDS = 60 * 60;
export const ALLOWED_UNLOCK_TTL_SECONDS = [15 * 60, 60 * 60, 8 * 60 * 60] as const;
const SEP53_PREFIX = Buffer.from('Stellar Signed Message:\n', 'utf8');

export class AuthServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'AuthServiceError';
    this.status = status;
    this.code = code;
  }
}

export interface AuthChallenge {
  transaction: string;
  message: string;
  network: StellarNetwork;
  networkPassphrase: string;
  signingKey: string;
}

export interface AuthSession {
  address: string;
  network: StellarNetwork;
  issuedAt: number;
  expiresAt: number;
}

interface AuthOptions {
  now?: Date;
  homeDomain: string;
  webAuthDomain: string;
  issuer: string;
  challengeTtlSeconds?: number;
  sessionTtlSeconds?: number;
}

interface ManageDataOperationShape {
  type: string;
  source?: string | null;
  name?: string;
  value?: Uint8Array | null;
}

interface JwtPayload {
  iss: string;
  sub: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
  auth_mode: 'private_workspace_unlock';
  stellar_network: StellarNetwork;
}

interface ValidatedChallenge {
  transaction: Exclude<ReturnType<typeof TransactionBuilder.fromXdr>, FeeBumpTransaction>;
  server: Keypair;
  client: Keypair;
  network: StellarNetwork;
  message: string;
  transactionHash: string;
}

function assertSignerAddress(address: string): Keypair {
  try {
    return Keypair.fromPublicKey(address);
  } catch {
    throw new AuthServiceError('A valid Stellar G address is required.', 400, 'invalid_account');
  }
}

function assertDomain(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 64 || !/^[a-z0-9.-]+(?::[0-9]+)?$/.test(normalized)) {
    throw new AuthServiceError(`Invalid ${label}.`, 500, 'invalid_auth_domain');
  }
  return normalized;
}

function assertAuthNetwork(value: unknown): StellarNetwork {
  if (value === 'public' || value === 'testnet') return value;
  throw new AuthServiceError('Authentication network must be Mainnet or Testnet.', 400, 'invalid_network');
}

export function resolveUnlockTtlSeconds(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_UNLOCK_TTL_SECONDS;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (ALLOWED_UNLOCK_TTL_SECONDS.some((allowed) => allowed === parsed)) return parsed;
  throw new AuthServiceError('Unlock duration must be 15 minutes, 1 hour, or 8 hours.', 400, 'invalid_unlock_duration');
}

function networkPassphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

function networkLabel(network: StellarNetwork): string {
  return network === 'testnet' ? 'Testnet' : 'Mainnet';
}

function unlockDurationLabel(seconds: number): string {
  if (seconds === 15 * 60) return '15 minutes';
  if (seconds === 8 * 60 * 60) return '8 hours';
  return '1 hour';
}

export async function getOrCreateAuthServerKeypair(
  store: AuthStore,
  now = new Date(),
): Promise<Keypair> {
  const existing = await store.getServerKey();
  if (existing) return Keypair.fromSecret(existing.secret);

  const proposed = Keypair.random();
  await store.createServerKey({
    version: 1,
    secret: proposed.secret(),
    createdAt: now.toISOString(),
  });

  const persisted = await store.getServerKey();
  if (!persisted) throw new AuthServiceError('Authentication service identity is unavailable.', 503, 'auth_key_unavailable');
  return Keypair.fromSecret(persisted.secret);
}

function authTransactionHashHex(transaction: { hash(): Uint8Array }): string {
  return Buffer.from(transaction.hash()).toString('hex');
}

function authChallengeReference(nonce: string): string {
  return Buffer.from(hash(Buffer.from(nonce, 'utf8'))).subarray(0, 16).toString('base64url');
}

function authMessage(
  nonce: string,
  address: string,
  network: StellarNetwork,
  webAuthDomain: string,
  challengeExpiresAtSeconds: number,
  unlockTtlSeconds: number,
): string {
  return [
    'Unlock MultiSig Tools',
    '',
    `Domain: ${webAuthDomain}`,
    `Account: ${address}`,
    `Network: ${networkLabel(network)}`,
    `Access: ${unlockDurationLabel(unlockTtlSeconds)}`,
    `Challenge expires: ${new Date(challengeExpiresAtSeconds * 1000).toISOString()}`,
    `Challenge: ${authChallengeReference(nonce)}`,
  ].join('\n');
}

function sep53MessageHash(message: string): Buffer {
  return Buffer.from(hash(Buffer.concat([SEP53_PREFIX, Buffer.from(message, 'utf8')])));
}

function operationValueText(operation: ManageDataOperationShape): string {
  return operation.value ? Buffer.from(operation.value).toString('utf8') : '';
}

function signatureCountForKey(
  transaction: { hash(): Uint8Array; signatures: Array<{ signature: { toBytes(): Uint8Array } }> },
  keypair: Keypair,
): number {
  const transactionHash = transaction.hash();
  return transaction.signatures.reduce(
    (count, decorated) => count + (keypair.verify(transactionHash, decorated.signature.toBytes()) ? 1 : 0),
    0,
  );
}

export async function createAuthChallenge(
  store: AuthStore,
  addressValue: string,
  networkValue: unknown,
  options: AuthOptions,
): Promise<AuthChallenge> {
  const address = addressValue.trim();
  assertSignerAddress(address);
  const network = assertAuthNetwork(networkValue);
  const passphrase = networkPassphrase(network);
  const homeDomain = assertDomain(options.homeDomain, 'home domain');
  const webAuthDomain = assertDomain(options.webAuthDomain, 'web auth domain');
  const now = options.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const challengeTtl = options.challengeTtlSeconds ?? DEFAULT_CHALLENGE_TTL_SECONDS;
  const unlockTtl = resolveUnlockTtlSeconds(options.sessionTtlSeconds);
  const challengeExpiresAt = nowSeconds + challengeTtl;
  const server = await getOrCreateAuthServerKeypair(store, now);

  // Sequence -1 is incremented by TransactionBuilder to zero. A sequence-zero
  // challenge cannot be submitted to Stellar. It remains the SEP-10 fallback
  // and carries the server nonce used by the preferred SEP-53 unlock message.
  const source = new Account(server.publicKey(), '-1');
  const nonce = randomBytes(48).toString('base64'); // SEP-10: exactly 64 bytes.
  const transaction = new TransactionBuilder(source, {
    fee: '100',
    networkPassphrase: passphrase,
  })
    .setTimebounds(nowSeconds, challengeExpiresAt)
    .addOperation(Operation.manageData({
      source: address,
      name: `${homeDomain} auth`,
      value: nonce,
    }))
    .addOperation(Operation.manageData({
      source: server.publicKey(),
      name: 'web_auth_domain',
      value: webAuthDomain,
    }))
    .build();

  transaction.sign(server);
  return {
    transaction: transaction.toXDR(),
    message: authMessage(nonce, address, network, webAuthDomain, challengeExpiresAt, unlockTtl),
    network,
    networkPassphrase: passphrase,
    signingKey: server.publicKey(),
  };
}

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function issueJwt(
  server: Keypair,
  address: string,
  network: StellarNetwork,
  options: AuthOptions,
  now: Date,
): { token: string; session: AuthSession } {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + resolveUnlockTtlSeconds(options.sessionTtlSeconds);
  const payload: JwtPayload = {
    iss: options.issuer,
    sub: address,
    aud: options.homeDomain,
    iat: issuedAt,
    exp: expiresAt,
    jti: randomUUID(),
    auth_mode: 'private_workspace_unlock',
    stellar_network: network,
  };
  const header = base64urlJson({ alg: 'EdDSA', typ: 'JWT' });
  const body = base64urlJson(payload);
  const unsigned = `${header}.${body}`;
  const signature = Buffer.from(server.sign(Buffer.from(unsigned))).toString('base64url');
  return {
    token: `${unsigned}.${signature}`,
    session: { address, network, issuedAt, expiresAt },
  };
}

async function validateAuthChallenge(
  store: AuthStore,
  challengeXdrValue: string,
  networkValue: unknown,
  options: AuthOptions,
): Promise<ValidatedChallenge> {
  const challengeXdr = challengeXdrValue.trim();
  if (!challengeXdr) throw new AuthServiceError('Unlock challenge is required.', 400, 'missing_challenge');

  const network = assertAuthNetwork(networkValue);
  const passphrase = networkPassphrase(network);
  const homeDomain = assertDomain(options.homeDomain, 'home domain');
  const webAuthDomain = assertDomain(options.webAuthDomain, 'web auth domain');
  const unlockTtl = resolveUnlockTtlSeconds(options.sessionTtlSeconds);
  const server = await getOrCreateAuthServerKeypair(store, options.now);

  let parsed;
  try {
    parsed = TransactionBuilder.fromXdr(challengeXdr, passphrase);
  } catch {
    throw new AuthServiceError('Unlock challenge is not valid Stellar XDR.', 400, 'invalid_challenge');
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new AuthServiceError('Unlock challenge must be a classic transaction.', 400, 'invalid_challenge');
  }

  const transaction = parsed;
  if (transaction.source !== server.publicKey() || transaction.sequence !== '0') {
    throw new AuthServiceError('Unlock challenge source or sequence is invalid.', 400, 'invalid_challenge');
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const minTime = Number(transaction.timeBounds?.minTime ?? '0');
  const maxTime = Number(transaction.timeBounds?.maxTime ?? '0');
  if (!maxTime || nowSeconds < minTime || nowSeconds > maxTime) {
    throw new AuthServiceError('Unlock challenge has expired or is not yet valid.', 401, 'challenge_expired');
  }

  if (transaction.operations.length !== 2) {
    throw new AuthServiceError('Unlock challenge contains unexpected operations.', 400, 'invalid_challenge');
  }
  const first = transaction.operations[0] as ManageDataOperationShape;
  const second = transaction.operations[1] as ManageDataOperationShape;
  if (first.type !== 'manageData' || !first.source || first.name !== `${homeDomain} auth`) {
    throw new AuthServiceError('Unlock challenge does not identify the expected wallet.', 400, 'invalid_challenge');
  }
  const nonce = operationValueText(first);
  if (nonce.length !== 64) {
    throw new AuthServiceError('Unlock challenge nonce is malformed.', 400, 'invalid_challenge');
  }
  if (
    second.type !== 'manageData'
    || second.source !== server.publicKey()
    || second.name !== 'web_auth_domain'
    || operationValueText(second) !== webAuthDomain
  ) {
    throw new AuthServiceError('Unlock challenge web domain is invalid.', 400, 'invalid_challenge');
  }

  const client = assertSignerAddress(first.source);
  if (signatureCountForKey(transaction, server) !== 1) {
    throw new AuthServiceError('Unlock challenge is not signed by this service.', 401, 'invalid_signature');
  }

  return {
    transaction,
    server,
    client,
    network,
    message: authMessage(nonce, first.source, network, webAuthDomain, maxTime, unlockTtl),
    transactionHash: authTransactionHashHex(transaction),
  };
}

async function claimAuthChallenge(
  store: AuthStore,
  transactionHash: string,
  now: Date,
): Promise<void> {
  const claimed = await store.claimChallengeRedemption({
    version: 1,
    transactionHash,
    redeemedAt: now.toISOString(),
  });
  if (!claimed) throw new AuthServiceError('This unlock challenge has already been used.', 409, 'challenge_replayed');
}

export async function exchangeAuthChallenge(
  store: AuthStore,
  signedXdrValue: string,
  networkValue: unknown,
  options: AuthOptions,
): Promise<{ token: string; session: AuthSession }> {
  const validated = await validateAuthChallenge(store, signedXdrValue, networkValue, options);
  const clientSignatures = signatureCountForKey(validated.transaction, validated.client);
  if (validated.transaction.signatures.length !== 2 || clientSignatures !== 1) {
    throw new AuthServiceError('Unlock challenge must be signed by the service and the selected wallet.', 401, 'invalid_signature');
  }

  const now = options.now ?? new Date();
  await claimAuthChallenge(store, validated.transactionHash, now);
  return issueJwt(validated.server, validated.client.publicKey(), validated.network, options, now);
}

export async function exchangeAuthMessageChallenge(
  store: AuthStore,
  challengeXdrValue: string,
  signatureValue: string,
  networkValue: unknown,
  options: AuthOptions,
): Promise<{ token: string; session: AuthSession }> {
  const validated = await validateAuthChallenge(store, challengeXdrValue, networkValue, options);
  if (validated.transaction.signatures.length !== 1) {
    throw new AuthServiceError('SEP-53 unlock must use the original server-issued challenge.', 400, 'invalid_challenge');
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureValue.trim(), 'base64');
  } catch {
    throw new AuthServiceError('Signed unlock message is malformed.', 400, 'invalid_signature');
  }
  if (signature.length !== 64 || !validated.client.verify(sep53MessageHash(validated.message), signature)) {
    throw new AuthServiceError('Unlock message was not signed by the selected wallet.', 401, 'invalid_signature');
  }

  const now = options.now ?? new Date();
  await claimAuthChallenge(store, validated.transactionHash, now);
  return issueJwt(validated.server, validated.client.publicKey(), validated.network, options, now);
}

function parseJwtPayload(token: string): { unsigned: string; signature: Uint8Array; payload: JwtPayload } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthServiceError('Private workspace unlock is invalid.', 401, 'invalid_session');
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg?: string };
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtPayload;
    if (header.alg !== 'EdDSA') throw new Error('unexpected alg');
    return {
      unsigned: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2], 'base64url'),
      payload,
    };
  } catch {
    throw new AuthServiceError('Private workspace unlock is invalid.', 401, 'invalid_session');
  }
}

export async function verifyAuthToken(
  store: AuthStore,
  token: string,
  options: Pick<AuthOptions, 'now' | 'homeDomain' | 'issuer'>,
): Promise<AuthSession> {
  const parsed = parseJwtPayload(token.trim());
  const server = await getOrCreateAuthServerKeypair(store, options.now);
  if (!server.verify(Buffer.from(parsed.unsigned), parsed.signature)) {
    throw new AuthServiceError('Private workspace unlock signature is invalid.', 401, 'invalid_session');
  }
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (
    parsed.payload.iss !== options.issuer
    || parsed.payload.aud !== options.homeDomain
    || parsed.payload.auth_mode !== 'private_workspace_unlock'
    || (parsed.payload.stellar_network !== 'public' && parsed.payload.stellar_network !== 'testnet')
    || !parsed.payload.sub
    || parsed.payload.exp <= nowSeconds
    || parsed.payload.iat > nowSeconds + 60
  ) {
    throw new AuthServiceError('Private workspace is locked or this unlock does not belong to this service.', 401, 'invalid_session');
  }
  assertSignerAddress(parsed.payload.sub);
  return {
    address: parsed.payload.sub,
    network: parsed.payload.stellar_network,
    issuedAt: parsed.payload.iat,
    expiresAt: parsed.payload.exp,
  };
}

export function authTokenFromRequest(request: Request): string {
  const authorization = request.headers.get('authorization')?.trim();
  if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  const cookie = request.headers.get('cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'mst_auth') return decodeURIComponent(rest.join('='));
  }
  return '';
}

export async function privateWorkspaceSessionFromRequest(
  store: AuthStore,
  request: Request,
  options: Pick<AuthOptions, 'now' | 'homeDomain' | 'issuer'>,
): Promise<AuthSession | null> {
  const token = authTokenFromRequest(request);
  if (!token) return null;
  return verifyAuthToken(store, token, options);
}

export async function requirePrivateWorkspaceSession(
  store: AuthStore,
  request: Request,
  options: Pick<AuthOptions, 'now' | 'homeDomain' | 'issuer'>,
  missingMessage: string,
): Promise<AuthSession> {
  const session = await privateWorkspaceSessionFromRequest(store, request, options);
  if (!session) throw new AuthServiceError(missingMessage, 401, 'authentication_required');
  return session;
}

export function authCookie(token: string, maxAgeSeconds = DEFAULT_UNLOCK_TTL_SECONDS): string {
  return `mst_auth=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearAuthCookie(): string {
  return 'mst_auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}
