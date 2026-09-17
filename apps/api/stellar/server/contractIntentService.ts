import {
  contractArgumentsToScVals,
  contractCallHostFunction,
  isValidContractId,
  loadContractInterface,
} from '../../../../src/stellar/contractSpec.js';
import type { LoadedContractInterface } from '../../../../src/stellar/contractSpec.js';
import { createSorobanIntent } from '../../../../src/stellar/sorobanIntent.js';
import type { SorobanIntent } from '../../../../src/stellar/sorobanIntent.js';
import type { StellarNetwork } from '../../../../src/stellar/types.js';

export class ContractIntentServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'ContractIntentServiceError';
  }
}

export interface BuiltContractIntent {
  operation: 'contract.intent.build';
  version: 1;
  network: StellarNetwork;
  contractId: string;
  method: string;
  intent: SorobanIntent;
}
type InterfaceLoader = (
  contractId: string,
  network: StellarNetwork,
) => Promise<LoadedContractInterface>;

function normalizedNetwork(value: unknown): StellarNetwork {
  if (value === 'public' || value === 'testnet') return value;
  throw new ContractIntentServiceError('Network must be public or testnet.', 400, 'invalid_network');
}

function normalizedArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractIntentServiceError('Contract arguments must be a JSON object.', 400, 'invalid_arguments');
  }
  const entries = Object.entries(value);
  if (entries.length > 64 || entries.some(([key]) => !key)) {
    throw new ContractIntentServiceError(
      'Contract arguments must contain at most 64 named values.',
      400,
      'invalid_arguments',
    );
  }
  return Object.fromEntries(entries);
}
export async function buildContractIntent(
  input: {
    network: unknown;
    contractId: unknown;
    method: unknown;
    arguments: unknown;
  },
  dependencies: { interfaceLoader?: InterfaceLoader } = {},
): Promise<BuiltContractIntent> {
  const network = normalizedNetwork(input.network);
  const contractId = typeof input.contractId === 'string' ? input.contractId.trim() : '';
  const method = typeof input.method === 'string' ? input.method.trim() : '';
  const rawArguments = normalizedArguments(input.arguments);

  if (!isValidContractId(contractId)) {
    throw new ContractIntentServiceError('A valid Stellar C... contract address is required.', 400, 'invalid_contract');
  }
  if (!method || method.length > 64) {
    throw new ContractIntentServiceError('A contract method is required.', 400, 'invalid_method');
  }

  let loaded: LoadedContractInterface;
  try {
    loaded = await (dependencies.interfaceLoader ?? loadContractInterface)(contractId, network);
  } catch (cause) {
    throw new ContractIntentServiceError(
      cause instanceof Error ? cause.message : 'Unable to load this contract interface.',
      502,
      'contract_interface_unavailable',
    );
  }
  const descriptor = loaded.methods.find((candidate) => candidate.name === method);
  if (!descriptor) {
    throw new ContractIntentServiceError('The contract does not expose this method.', 400, 'invalid_method');
  }
  if (!descriptor.guided) {
    throw new ContractIntentServiceError(
      'This method requires exact XDR because its inputs are not supported by the guided builder.',
      400,
      'unsupported_method',
    );
  }

  let args;
  try {
    args = contractArgumentsToScVals(loaded.spec, method, rawArguments);
  } catch (cause) {
    throw new ContractIntentServiceError(
      cause instanceof Error ? cause.message : 'Contract arguments are invalid.',
      400,
      'invalid_arguments',
    );
  }

  const hostFunction = contractCallHostFunction(contractId, method, args);
  return {
    operation: 'contract.intent.build',
    version: 1,
    network,
    contractId,
    method,
    intent: createSorobanIntent(network, hostFunction),
  };
}
