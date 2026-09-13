import { Account, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import {
  contractArgumentsToScVals,
  contractCallOperation,
  isValidContractId,
  loadContractInterface,
} from '../src/stellar/contractSpec.js';
import type { ContractMethodDescriptor, LoadedContractInterface } from '../src/stellar/contractSpec.js';
import {
  AccountNotFoundError,
  isValidStellarAccountId,
  loadAccount,
  loadNetworkParameters,
} from '../src/stellar/horizon.js';
import { isTransactionLifetimeSeconds } from '../src/stellar/transactionPreferences.js';
import type { StellarNetwork } from '../src/stellar/types.js';

export class ContractCallServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ContractCallServiceError';
    this.status = status;
    this.code = code;
  }
}

export interface ContractInterfaceResult {
  operation: 'contract.interface.inspect';
  version: 1;
  network: StellarNetwork;
  contractId: string;
  methods: ContractMethodDescriptor[];
}

export interface BuildContractCallInput {
  network: StellarNetwork;
  transactionSource: string;
  contractId: string;
  method: string;
  arguments: Record<string, string>;
  lifetimeSeconds: number;
}

export interface BuiltContractCall {
  operation: 'contract.call.build';
  version: 1;
  network: StellarNetwork;
  transactionSource: string;
  sourceSequence: string;
  contractId: string;
  method: string;
  xdr: string;
  validUntil: string;
}

type InterfaceLoader = (contractId: string, network: StellarNetwork) => Promise<LoadedContractInterface>;
type AccountLoader = (accountId: string, network: StellarNetwork) => Promise<{ accountId: string; sequence: string }>;
type NetworkParametersLoader = (network: StellarNetwork) => Promise<{ baseFeeInStroops: number }>;

interface ContractCallDependencies {
  interfaceLoader?: InterfaceLoader;
  accountLoader?: AccountLoader;
  networkParametersLoader?: NetworkParametersLoader;
}

function normalizedNetwork(value: unknown): StellarNetwork {
  if (value === 'public' || value === 'testnet') return value;
  throw new ContractCallServiceError('Network must be public or testnet.', 400, 'invalid_network');
}

function normalizedArguments(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractCallServiceError('Contract arguments must be a JSON object.', 400, 'invalid_arguments');
  }
  const entries = Object.entries(value);
  if (entries.length > 64 || entries.some(([key, item]) => !key || typeof item !== 'string')) {
    throw new ContractCallServiceError('Contract arguments must contain at most 64 named string values.', 400, 'invalid_arguments');
  }
  return Object.fromEntries(entries);
}

function passphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

export async function inspectContractInterface(
  contractIdValue: string,
  networkValue: unknown,
  dependencies: Pick<ContractCallDependencies, 'interfaceLoader'> = {},
): Promise<ContractInterfaceResult> {
  const network = normalizedNetwork(networkValue);
  const contractId = contractIdValue.trim();
  if (!isValidContractId(contractId)) {
    throw new ContractCallServiceError('A valid Stellar C... contract address is required.', 400, 'invalid_contract');
  }
  try {
    const loaded = await (dependencies.interfaceLoader ?? loadContractInterface)(contractId, network);
    return { operation: 'contract.interface.inspect', version: 1, contractId, network, methods: loaded.methods };
  } catch (cause) {
    if (cause instanceof ContractCallServiceError) throw cause;
    throw new ContractCallServiceError(
      cause instanceof Error ? cause.message : 'Unable to load this contract interface.',
      502,
      'contract_interface_unavailable',
    );
  }
}

export async function buildContractCall(
  input: {
    network: unknown;
    transactionSource: unknown;
    contractId: unknown;
    method: unknown;
    arguments: unknown;
    lifetimeSeconds: unknown;
  },
  dependencies: ContractCallDependencies = {},
): Promise<BuiltContractCall> {
  const network = normalizedNetwork(input.network);
  const transactionSource = typeof input.transactionSource === 'string' ? input.transactionSource.trim() : '';
  const contractId = typeof input.contractId === 'string' ? input.contractId.trim() : '';
  const method = typeof input.method === 'string' ? input.method.trim() : '';
  const lifetimeSeconds = Number(input.lifetimeSeconds);
  const rawArguments = normalizedArguments(input.arguments);

  if (!isValidStellarAccountId(transactionSource)) {
    throw new ContractCallServiceError('A valid Stellar G... transaction source is required.', 400, 'invalid_source');
  }
  if (!isValidContractId(contractId)) {
    throw new ContractCallServiceError('A valid Stellar C... contract address is required.', 400, 'invalid_contract');
  }
  if (!method || method.length > 64) {
    throw new ContractCallServiceError('A contract method is required.', 400, 'invalid_method');
  }
  if (!Number.isSafeInteger(lifetimeSeconds) || !isTransactionLifetimeSeconds(lifetimeSeconds)) {
    throw new ContractCallServiceError('Transaction lifetime must be 1 hour, 24 hours, or 7 days.', 400, 'invalid_lifetime');
  }

  let loaded: LoadedContractInterface;
  let source: Awaited<ReturnType<AccountLoader>>;
  let parameters: Awaited<ReturnType<NetworkParametersLoader>>;
  try {
    [loaded, source, parameters] = await Promise.all([
      (dependencies.interfaceLoader ?? loadContractInterface)(contractId, network),
      (dependencies.accountLoader ?? loadAccount)(transactionSource, network),
      (dependencies.networkParametersLoader ?? loadNetworkParameters)(network),
    ]);
  } catch (cause) {
    if (cause instanceof AccountNotFoundError) {
      throw new ContractCallServiceError(cause.message, 404, 'source_not_found');
    }
    throw new ContractCallServiceError(
      cause instanceof Error ? cause.message : 'Unable to load current Stellar state.',
      502,
      'stellar_state_unavailable',
    );
  }

  const descriptor = loaded.methods.find((candidate) => candidate.name === method);
  if (!descriptor) throw new ContractCallServiceError('The contract does not expose this method.', 400, 'invalid_method');
  if (!descriptor.guided) {
    throw new ContractCallServiceError('This method requires exact XDR because its inputs are not supported by the guided builder.', 400, 'unsupported_method');
  }

  let args;
  try {
    args = contractArgumentsToScVals(loaded.spec, method, rawArguments);
  } catch (cause) {
    throw new ContractCallServiceError(
      cause instanceof Error ? cause.message : 'Contract arguments are invalid.',
      400,
      'invalid_arguments',
    );
  }

  const transaction = new TransactionBuilder(new Account(source.accountId, source.sequence), {
    fee: String(parameters.baseFeeInStroops),
    networkPassphrase: passphrase(network),
  })
    .addOperation(contractCallOperation(contractId, method, args))
    .setTimeout(lifetimeSeconds)
    .build();
  const maxTime = Number(transaction.timeBounds?.maxTime ?? '0');

  return {
    operation: 'contract.call.build',
    version: 1,
    network,
    transactionSource: source.accountId,
    contractId,
    method,
    xdr: transaction.toXDR(),
    sourceSequence: source.sequence,
    validUntil: new Date(maxTime * 1000).toISOString(),
  };
}
