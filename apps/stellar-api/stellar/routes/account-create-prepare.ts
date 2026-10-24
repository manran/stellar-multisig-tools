import { blobAgentCredentialStore } from '../server/blobAgentCredentialStore.js';
import { blobAuthStore } from '../server/blobAuthStore.js';
import { AgentCredentialServiceError, requireAgentAccess } from '../server/agentCredentialService.js';
import {
  CallerAuthenticationError,
  machineCallerFromRequest,
  verifiedSignerSessionFromRequest,
} from '../server/callerAuthentication.js';
import {
  ClassicCreateAccountPrepareError,
  prepareClassicCreateAccount,
} from '../../../../packages/stellar-core/src/classicCreateAccountPrepare.js';
import { IntegrationCredentialServiceError } from '../server/integrationCredentialService.js';
import { assertDeploymentNetwork, DeploymentNetworkPolicyError } from '../server/deploymentNetworkPolicy.js';
import { noStoreJson } from '../server/httpResponse.js';
import { readJsonObjectBody, RequestBodyError } from '../server/requestBody.js';
import { signerCanAccessTransaction } from '../server/requestAccess.js';
import { loadAccount } from '../../../../packages/stellar-core/src/horizon.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

const MAX_BODY_BYTES = 64 * 1024;

function errorResponse(cause: unknown): Response {
  if (
    cause instanceof RequestBodyError
    || cause instanceof ClassicCreateAccountPrepareError
    || cause instanceof CallerAuthenticationError
    || cause instanceof AgentCredentialServiceError
    || cause instanceof IntegrationCredentialServiceError
    || cause instanceof DeploymentNetworkPolicyError
  ) {
    return noStoreJson({ error: cause.message, code: cause.code }, cause.status);
  }
  console.error('Classic account create prepare API error', cause);
  return noStoreJson({ error: 'Classic account creation preparation is temporarily unavailable.', code: 'internal_error' }, 500);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonObjectBody(request, MAX_BODY_BYTES);
    const network = body.network === 'public' || body.network === 'testnet' ? body.network : null;
    if (!network) throw new ClassicCreateAccountPrepareError('Network must be public or testnet.', 400, 'invalid_network');
    assertDeploymentNetwork(network);

    const sourceAccount = typeof body.sourceAccount === 'string' ? body.sourceAccount.trim() : '';
    const machineCaller = await machineCallerFromRequest(blobAgentCredentialStore, request);
    const service = machineCaller?.kind === 'service' ? machineCaller.credential : null;
    const agent = machineCaller?.kind === 'agent' ? machineCaller.credential : null;

    if (service) {
      if (!service.networks.includes(network)) {
        throw new IntegrationCredentialServiceError(
          'This Integration credential is not allowed on this Stellar network.', 403, 'integration_network_not_allowed',
        );
      }
      if (!service.classicSourceAccounts.includes(sourceAccount)) {
        throw new IntegrationCredentialServiceError(
          'This Integration credential is not allowed to prepare account creation from that Classic source account.',
          403,
          'integration_classic_source_account_not_allowed',
        );
      }
    } else if (agent) {
      if (agent.principal.network !== network) {
        throw new AgentCredentialServiceError('This Agent credential is for another Stellar network.', 403, 'principal_network_mismatch');
      }
      requireAgentAccess(agent, 'write');
    }

    const accountCache = new Map<string, ReturnType<typeof loadAccount>>();
    const accountLoader = (accountId: string, requestedNetwork: StellarNetwork) => {
      const key = `${requestedNetwork}:${accountId}`;
      const cached = accountCache.get(key);
      if (cached) return cached;
      const pending = loadAccount(accountId, requestedNetwork);
      accountCache.set(key, pending);
      return pending;
    };

    let humanAddress = '';
    if (!service && !agent) {
      const session = await verifiedSignerSessionFromRequest(blobAuthStore, request, network);
      if (!session) {
        throw new ClassicCreateAccountPrepareError(
          'Confirm a signer wallet before preparing Classic account creation.',
          401,
          'classic_account_create_prepare_identity_required',
        );
      }
      humanAddress = session.address;
    }

    const result = await prepareClassicCreateAccount({
      network,
      sourceAccount: body.sourceAccount,
      destination: body.destination,
      startingBalance: body.startingBalance,
      memo: body.memo,
      memoHashHex: body.memoHashHex,
      lifetimeSeconds: body.lifetimeSeconds,
    }, { accountLoader });

    const signerAddress = agent?.principal.address ?? humanAddress;
    if (signerAddress) {
      const allowed = await signerCanAccessTransaction(signerAddress, result.xdr, network, accountLoader);
      if (!allowed) {
        throw new ClassicCreateAccountPrepareError(
          'The confirmed signer is not a current signer for this account-creation source.',
          403,
          'classic_account_create_prepare_source_access_denied',
        );
      }
    }

    return noStoreJson(result);
  } catch (cause) {
    return errorResponse(cause);
  }
}
