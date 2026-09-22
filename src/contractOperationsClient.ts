import type { ContractAbiDescriptor, ContractMethodDescriptor } from '../packages/stellar-core/src/contractSpec';
import { SorobanSimulationError } from '../packages/stellar-core/src/sorobanRpc';
import type { SorobanSimulationSummary } from '../packages/stellar-core/src/sorobanRpc';
import type { SorobanEffectsSnapshot } from '../packages/stellar-core/src/sorobanEffects';
import type { StellarNetwork } from '../packages/stellar-core/src/types';

export interface ContractWorkspaceRef {
  contractId: string;
  network: StellarNetwork;
  createdAt: string;
  updatedAt: string;
}

interface ApiErrorBody {
  error?: string;
  code?: string;
}

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & ApiErrorBody;
  if (!response.ok) throw new Error(body.error || `${fallback} (${response.status}).`);
  return body;
}

export async function inspectContractOperation(
  contractId: string,
  network: StellarNetwork,
): Promise<{ contractId: string; network: StellarNetwork; methods: ContractMethodDescriptor[]; abi: ContractAbiDescriptor }> {
  const query = new URLSearchParams({ contract: contractId, network });
  const response = await fetch(`/api/contract-interface?${query}`, { cache: 'no-store' });
  const body = await responseJson<{
    contractId: string;
    network: StellarNetwork;
    methods: ContractMethodDescriptor[];
    abi: ContractAbiDescriptor;
  }>(response, 'Unable to load contract interface');
  if (!Array.isArray(body.methods) || body.abi?.schema !== 'fresnica-soroban-abi-v1') throw new Error('Contract interface response is invalid.');
  return body;
}

export async function buildContractCallOperation(input: {
  network: StellarNetwork;
  transactionSource: string;
  contractId: string;
  method: string;
  arguments: Record<string, unknown>;
  lifetimeSeconds: number;
}): Promise<{ xdr: string; validUntil: string }> {
  const response = await fetch('/api/contract-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await responseJson<{ xdr?: string; validUntil?: string }>(response, 'Unable to build contract call');
  if (!body.xdr || !body.validUntil) throw new Error('Contract call response is invalid.');
  return { xdr: body.xdr, validUntil: body.validUntil };
}

export async function prepareContractCallOperation(input: {
  network: StellarNetwork;
  xdr: string;
}): Promise<SorobanSimulationSummary> {
  const response = await fetch('/api/contract-prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({})) as {
    simulation?: SorobanSimulationSummary;
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    const kind = body.code?.replace('soroban_simulation_', '');
    if (kind === 'unsupported' || kind === 'configuration' || kind === 'unavailable' || kind === 'invalid') {
      throw new SorobanSimulationError(kind, body.error || 'Contract call preparation failed.');
    }
    throw new Error(body.error || `Contract call preparation failed (${response.status}).`);
  }
  if (!body.simulation) throw new Error('Contract call preparation response is invalid.');
  return body.simulation;
}

export async function verifyPreparedContractCallOperation(input: {
  network: StellarNetwork;
  xdr: string;
}): Promise<{ endpointUrl: string; latestLedger: number; effects: SorobanEffectsSnapshot }> {
  const response = await fetch('/api/contract-prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...input, mode: 'enforce' }),
  });
  const body = await response.json().catch(() => ({})) as {
    verification?: { endpointUrl: string; latestLedger: number; effects: SorobanEffectsSnapshot };
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    const kind = body.code?.replace('soroban_simulation_', '');
    if (kind === 'unsupported' || kind === 'configuration' || kind === 'unavailable' || kind === 'invalid') {
      throw new SorobanSimulationError(kind, body.error || 'Contract call verification failed.');
    }
    throw new Error(body.error || `Contract call verification failed (${response.status}).`);
  }
  if (!body.verification?.effects) throw new Error('Contract call verification response is invalid.');
  return body.verification;
}

export async function listContractWorkspaceOperation(): Promise<ContractWorkspaceRef[]> {
  const response = await fetch('/api/contracts', { cache: 'no-store', headers: { Accept: 'application/json' } });
  const body = await responseJson<{ contracts?: ContractWorkspaceRef[] }>(response, 'Unable to load contracts');
  if (!Array.isArray(body.contracts)) throw new Error('Contract workspace response is invalid.');
  return body.contracts;
}

export async function keepContractOperation(
  contractId: string,
  network: StellarNetwork,
): Promise<ContractWorkspaceRef> {
  const response = await fetch('/api/contracts', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ contractId, network }),
  });
  const body = await responseJson<{ contract?: ContractWorkspaceRef }>(response, 'Unable to save contract');
  if (!body.contract) throw new Error('Contract workspace response is invalid.');
  return body.contract;
}

export async function forgetContractOperation(contractId: string, network: StellarNetwork): Promise<void> {
  const response = await fetch('/api/contracts', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ contractId, network }),
  });
  await responseJson(response, 'Unable to remove contract');
}
