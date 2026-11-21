import { blobAuthStore } from '../server/blobAuthStore.js';
import { AuthServiceError, requirePrivateWorkspaceSession } from '../server/authService.js';
import { authConfigForRequest } from '../server/authConfig.js';
import { configuredDeploymentNetwork } from '../server/deploymentNetworkPolicy.js';
import { noStoreJson } from '../server/httpResponse.js';
import { loadSaintAccountSecurity, SaintHistoryUnavailable } from '../server/saintAccountSecurity.js';
import { isValidStellarAccountId } from '../../../../packages/stellar-core/src/horizon.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const session = await requirePrivateWorkspaceSession(
      blobAuthStore, request, authConfigForRequest(request),
      'Confirm your wallet to view optional security history.',
    );
    const address = new URL(request.url).searchParams.get('address') ?? '';
    if (!isValidStellarAccountId(address)) {
      return noStoreJson({ error: 'A valid Stellar account address is required.', code: 'invalid_address' }, 400);
    }
    const consumer = process.env.SAINT_TESTNET_CONSUMER_URL?.trim();
    if (session.network !== 'testnet' || configuredDeploymentNetwork() !== 'testnet' || !consumer) {
      return noStoreJson({ error: 'Optional security history is not available for this network.', code: 'saint_not_configured' }, 503);
    }
    return noStoreJson(await loadSaintAccountSecurity(address, consumer));
  } catch (cause) {
    if (cause instanceof AuthServiceError) {
      return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
    }
    if (!(cause instanceof SaintHistoryUnavailable)) {
      console.warn('Optional SAINT history is unavailable.');
    }
    // SAINT is informational. This endpoint cannot block MST authorization or submission.
    return noStoreJson({ error: 'Security history is temporarily unavailable.', code: 'saint_history_unavailable' }, 503);
  }
}
