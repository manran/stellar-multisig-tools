import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobBoxStore } from '../server/blobBoxStore.js';
import { RequestStorageUnavailableError } from '../server/blobRequestStore.js';
import {
  AgentCredentialServiceError,
  authenticateAgentCredential,
  requireAgentAccess,
} from '../server/agentCredentialService.js';
import { noStoreJson } from '../server/httpResponse.js';
import { loadAccountsForSigner } from '../../../../src/stellar/signerAccounts.js';
import { hasSharedSigningControl } from '../../../../src/stellar/treasuryModel.js';
import { treasuryBoxRef } from '../server/boxService.js';

function bearerToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new AgentCredentialServiceError('Bearer Agent credential is required.', 401, 'agent_credential_required');
  return match[1].trim();
}

export async function GET(request: Request): Promise<Response> {
  try {
    const credential = await authenticateAgentCredential(blobAgentCredentialStore, bearerToken(request));
    requireAgentAccess(credential, 'read');
    const { principal } = credential;
    const accounts = (await loadAccountsForSigner(principal.address, principal.network)).filter(hasSharedSigningControl);
    const treasuries = await Promise.all(accounts.map(async (account) => {
      const metadata = await blobBoxStore.getMetadata(treasuryBoxRef(principal.network, account.accountId));
      return {
        accountId: account.accountId,
        name: metadata?.name,
        thresholds: account.thresholds,
        signers: account.signers,
      };
    }));
    await blobAgentCredentialStore.touchCredential(credential.credentialId, new Date().toISOString());
    return noStoreJson({ principal, treasuries });
  } catch (cause) {
    if (cause instanceof AgentCredentialServiceError) return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof RequestStorageUnavailableError) return noStoreJson({ error: cause.message, code: 'storage_not_configured' }, 503);
    console.error('Signer treasuries API error', cause);
    return noStoreJson({ error: 'Treasury discovery is temporarily unavailable.', code: 'internal_error' }, 500);
  }
}
