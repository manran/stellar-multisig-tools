import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { authConfigForRequest } from './authConfig.js';
import { getOrCreateAuthServerKeypair } from './authService.js';
import { blobAuthStore } from './blobAuthStore.js';
import type { AuthStore } from './authStore.js';
import { verifiedSignerSessionFromRequest } from './callerAuthentication.js';
import { runtimeReusableTemplateStore } from './coordinationStores.js';
import { requireTemplateOwnerSigner } from './reusableTemplateService.js';
import { PostgresIdentityStore, IdentityError, type IdentityInvitation } from './identityStore.js';

export interface UserIdentity {
  userId: string;
  network: StellarNetwork;
  method: 'passkey' | 'stellar_wallet';
  address?: string;
  credentialId?: string;
  expiresAt?: number;
}

export function identityTokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

const TOKEN_COOKIE = '__Host-mst-identity';
const TOKEN_TTL = 8 * 60 * 60;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

function bearerCookie(request: Request): string {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === TOKEN_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export function identityCookie(token: string): string {
  return `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TOKEN_TTL}`;
}

export function clearIdentityCookie(): string {
  return `${TOKEN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function originFor(request: Request): string {
  return authConfigForRequest(request).issuer.replace(/\/api\/auth$/, '');
}

function relyingPartyId(request: Request): string {
  const host = new URL(originFor(request)).hostname;
  return host === 'multisig.tools' || host.endsWith('.multisig.tools') ? 'multisig.tools' : host;
}

export async function issuePasskeySession(request: Request, userId: string, credentialId: string,
  network: StellarNetwork, authStore: AuthStore = blobAuthStore): Promise<string> {
  const config = authConfigForRequest(request);
  const key = await getOrCreateAuthServerKeypair(authStore);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: `${config.issuer}/identity`, aud: config.homeDomain,
    sub: userId, credential_id: credentialId, stellar_network: network,
    auth_mode: 'mst_passkey', iat: now, exp: now + TOKEN_TTL, jti: randomUUID(),
  };
  const head = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'EdDSA' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = Buffer.from(key.sign(Buffer.from(`${head}.${body}`))).toString('base64url');
  return `${head}.${body}.${signature}`;
}

export async function passkeyIdentityFromRequest(request: Request, store: PostgresIdentityStore,
  authStore: AuthStore = blobAuthStore): Promise<UserIdentity | null> {
  const token = bearerCookie(request);
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) throw new IdentityError('Passkey session is invalid.', 401, 'identity_session_invalid');
  let payload: Record<string, unknown>;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as Record<string, unknown>;
    if (header.typ !== 'JWT' || header.alg !== 'EdDSA') throw new Error('wrong algorithm');
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Record<string, unknown>;
  } catch {
    throw new IdentityError('Passkey session is invalid.', 401, 'identity_session_invalid');
  }
  const config = authConfigForRequest(request);
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== `${config.issuer}/identity` || payload.aud !== config.homeDomain
    || payload.auth_mode !== 'mst_passkey' || !UUID.test(String(payload.sub ?? ''))
    || typeof payload.credential_id !== 'string'
    || (payload.stellar_network !== 'testnet' && payload.stellar_network !== 'public')
    || typeof payload.exp !== 'number' || payload.exp <= now
    || typeof payload.iat !== 'number' || payload.iat > now + 60 || payload.iat <= now - TOKEN_TTL - 60) {
    throw new IdentityError('Passkey session is expired or invalid.', 401, 'identity_session_invalid');
  }
  const key = await getOrCreateAuthServerKeypair(authStore);
  if (!key.verify(Buffer.from(`${parts[0]}.${parts[1]}`), Buffer.from(parts[2], 'base64url'))) {
    throw new IdentityError('Passkey session signature is invalid.', 401, 'identity_session_invalid');
  }
  const credential = await store.findCredential('passkey', payload.credential_id);
  if (!credential || credential.userId !== payload.sub) {
    throw new IdentityError('Passkey credential no longer belongs to this user.', 401, 'identity_session_revoked');
  }
  return { userId: credential.userId, network: payload.stellar_network,
    method: 'passkey', credentialId: credential.subject, expiresAt: payload.exp };
}

/** The wallet path must still have a full SEP-53 proof and the selected-wallet header. */
export async function currentUserIdentity(
  request: Request,
  store: PostgresIdentityStore,
  network: StellarNetwork,
): Promise<UserIdentity | null> {
  const wallet = await verifiedSignerSessionFromRequest(blobAuthStore, request, network);
  if (wallet) return { userId: await store.walletUser(wallet.address),
    network, method: 'stellar_wallet', address: wallet.address, expiresAt: wallet.expiresAt };
  const passkey = await passkeyIdentityFromRequest(request, store);
  return passkey?.network === network ? passkey : null;
}

export async function requireUserIdentity(request: Request, store: PostgresIdentityStore, network: StellarNetwork): Promise<UserIdentity> {
  const identity = await currentUserIdentity(request, store, network);
  if (!identity) throw new IdentityError('Sign in with Passkey or verify a Stellar wallet.', 401, 'identity_required');
  return identity;
}

export async function createTemplateInvitation(
  request: Request,
  store: PostgresIdentityStore,
  templateId: string,
  network: StellarNetwork,
): Promise<{ token: string; expiresInSeconds: number }> {
  const identity = await requireUserIdentity(request, store, network);
  if (!identity.address) throw new IdentityError('A current Treasury signer must issue invitations.', 403, 'invitation_owner_required');
  const template = await runtimeReusableTemplateStore().getTemplateVersion(templateId, 1);
  if (!template || template.template.ownerAddress !== identity.address || template.template.network !== network
    || template.template.kind !== 'payment' || template.template.archivedAt) {
    throw new IdentityError('Template is not available for this Treasury signer.', 404, 'template_not_found');
  }
  await requireTemplateOwnerSigner(template);
  const token = randomBytes(32).toString('base64url');
  await store.createInvitation(templateId, network, identity.address, identityTokenHash(token));
  return { token, expiresInSeconds: 24 * 60 * 60 };
}

export async function requireTemplateInviter(request: Request, store: PostgresIdentityStore,
  templateId: string, network: StellarNetwork): Promise<{ owner: string }> {
  const identity = await requireUserIdentity(request, store, network);
  if (!identity.address) throw new IdentityError('Confirm a Treasury signer wallet.', 403, 'invitation_owner_required');
  const template = await runtimeReusableTemplateStore().getTemplateVersion(templateId, 1);
  if (!template || template.template.ownerAddress !== identity.address || template.template.network !== network
    || template.template.kind !== 'payment' || template.template.archivedAt) {
    throw new IdentityError('Template is not owned by this signer.', 404, 'template_not_found');
  }
  await requireTemplateOwnerSigner(template);
  return { owner: identity.address };
}

export async function availableInvitation(store: PostgresIdentityStore, token: string): Promise<IdentityInvitation> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new IdentityError('Invitation not found or expired.', 404, 'invitation_invalid');
  }
  const value = await store.invitation(identityTokenHash(token));
  if (!value) throw new IdentityError('Invitation not found or expired.', 404, 'invitation_invalid');
  return value;
}

/** Passkey registration needs either an existing authenticated user or an invitation. */
export async function startPasskeyRegistration(request: Request, store: PostgresIdentityStore, network: StellarNetwork, inviteToken?: string) {
  const identity = await currentUserIdentity(request, store, network);
  const invitation = inviteToken ? await availableInvitation(store, inviteToken) : null;
  if (invitation && invitation.network !== network) throw new IdentityError('This invitation is for another network.', 403, 'invitation_network_mismatch');
  if (!identity && !invitation) throw new IdentityError('An invitation or current login is needed to add a Passkey.', 401, 'passkey_registration_not_authorized');
  const userId = identity?.userId ?? randomUUID();
  const current = identity ? await store.listCredentials(userId) : [];
  const options = await generateRegistrationOptions({
    rpName: 'MultiSig Tools', rpID: relyingPartyId(request),
    userName: `mst-${userId.slice(0, 8)}`, userDisplayName: 'MultiSig Tools user',
    userID: Buffer.from(userId.replace(/-/g, ''), 'hex'),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: current.filter((item) => item.kind === 'passkey').map((item) => ({ id: item.subject, transports: item.transports as AuthenticatorTransport[] })),
  });
  const challenge = await store.createChallenge({ challenge: options.challenge, purpose: 'register', userId,
    invitationId: invitation?.id ?? null, network });
  return { options, challengeId: challenge.id };
}

export async function finishPasskeyRegistration(request: Request, store: PostgresIdentityStore,
  challengeId: string, response: RegistrationResponseJSON) {
  const challenge = await store.consumeChallenge(challengeId, 'register');
  if (!challenge.userId) throw new IdentityError('Registration account is missing.', 400, 'invalid_registration');
  const identity = await currentUserIdentity(request, store, challenge.network);
  if (identity && identity.userId !== challenge.userId) {
    throw new IdentityError('This registration belongs to another user.', 403, 'registration_user_mismatch');
  }
  // A new account may only come from a single-use invitation.
  if (!identity && !challenge.invitationId) throw new IdentityError('Registration needs a verified account.', 401, 'registration_not_authorized');
  let verified;
  try {
    verified = await verifyRegistrationResponse({ response,
      expectedChallenge: challenge.challenge, expectedOrigin: originFor(request),
      expectedRPID: relyingPartyId(request), requireUserVerification: true });
  } catch {
    throw new IdentityError('Passkey registration could not be verified.', 400, 'registration_unverified');
  }
  if (!verified.verified || !verified.registrationInfo) {
    throw new IdentityError('Passkey registration was not accepted.', 400, 'registration_unverified');
  }
  const info = verified.registrationInfo;
  await store.registerPasskey({
    userId: challenge.userId, newUser: !identity,
    invitationId: challenge.invitationId,
    id: info.credential.id, publicKey: info.credential.publicKey, counter: info.credential.counter,
    transports: response.response.transports ?? [],
    deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp,
  });
  return { userId: challenge.userId, network: challenge.network,
    token: await issuePasskeySession(request, challenge.userId, info.credential.id, challenge.network) };
}

export async function startPasskeyAuthentication(request: Request, store: PostgresIdentityStore, network: StellarNetwork) {
  const options = await generateAuthenticationOptions({
    rpID: relyingPartyId(request), userVerification: 'required',
    // Discoverable credentials allow sign-in without usernames or wallet addresses.
  });
  const challenge = await store.createChallenge({ challenge: options.challenge,
    purpose: 'authenticate', userId: null, invitationId: null, network });
  return { options, challengeId: challenge.id };
}

export async function finishPasskeyAuthentication(request: Request, store: PostgresIdentityStore,
  challengeId: string, response: AuthenticationResponseJSON) {
  const challenge = await store.consumeChallenge(challengeId, 'authenticate');
  const passkey = await store.findCredential('passkey', response.id);
  if (!passkey?.publicKey) throw new IdentityError('Passkey is not registered.', 401, 'unknown_passkey');
  let verified;
  try {
    verified = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge,
      expectedOrigin: originFor(request), expectedRPID: relyingPartyId(request),
      credential: { id: passkey.subject, publicKey: passkey.publicKey,
        counter: passkey.counter, transports: passkey.transports as AuthenticatorTransport[] },
      requireUserVerification: true });
  } catch {
    throw new IdentityError('Passkey verification failed.', 401, 'passkey_unverified');
  }
  if (!verified.verified) throw new IdentityError('Passkey verification failed.', 401, 'passkey_unverified');
  await store.updatePasskeyCounter(passkey.id, passkey.counter, verified.authenticationInfo.newCounter);
  return { userId: passkey.userId, network: challenge.network,
    token: await issuePasskeySession(request, passkey.userId, passkey.subject, challenge.network) };
}

/** Both proofs are required: active Passkey session AND a verified wallet cookie. */
export async function linkVerifiedWallet(request: Request, store: PostgresIdentityStore, network: StellarNetwork): Promise<UserIdentity> {
  const passkey = await passkeyIdentityFromRequest(request, store);
  const wallet = await verifiedSignerSessionFromRequest(blobAuthStore, request, network);
  if (!passkey || passkey.network !== network || !wallet) {
    throw new IdentityError('Confirm both Passkey and wallet before linking.', 401, 'wallet_link_proofs_required');
  }
  await store.linkWallet(passkey.userId, wallet.address);
  return { ...passkey, address: wallet.address };
}
