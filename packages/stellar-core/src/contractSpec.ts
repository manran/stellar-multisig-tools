import { Address, Networks, Operation, StrKey, xdr } from '@stellar/stellar-sdk/base';
import type { Spec } from '@stellar/stellar-sdk/contract';
import type { ScVal } from '@stellar/stellar-sdk/xdr';
import { stellarRpcUrl } from './sorobanRpc.js';
import type { StellarNetwork } from './types.js';
import { describeContractAbi, describeContractSpec } from './sorobanAbi.js';
import type { ContractAbiDescriptor, ContractMethodDescriptor } from './sorobanAbi.js';

export * from './sorobanAbi.js';

export interface LoadedContractInterface {
  spec: Spec;
  methods: ContractMethodDescriptor[];
  abi?: ContractAbiDescriptor;
}

function networkPassphrase(network: StellarNetwork): string {
  return network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
}

export function isValidContractId(value: string): boolean {
  return StrKey.isValidContract(value.trim());
}

export async function loadContractInterface(
  contractId: string,
  network: StellarNetwork,
): Promise<LoadedContractInterface> {
  const normalized = contractId.trim();
  if (!isValidContractId(normalized)) throw new Error('Enter a valid Stellar C... contract address.');
  const { Client } = await import('@stellar/stellar-sdk/contract');
  const client = await Client.from({
    contractId: normalized,
    rpcUrl: stellarRpcUrl(network),
    networkPassphrase: networkPassphrase(network),
  });
  return {
    spec: client.spec,
    methods: describeContractSpec(client.spec),
    abi: describeContractAbi(client.spec),
  };
}

export function contractCallHostFunction(
  contractId: string,
  methodName: string,
  args: ScVal[],
) {
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contractId.trim()).toScAddress(),
    functionName: methodName,
    args,
  });
  return xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs);
}

export function contractCallOperation(
  contractId: string,
  methodName: string,
  args: ScVal[],
) {
  return Operation.invokeHostFunction({
    func: contractCallHostFunction(contractId, methodName, args),
    auth: [],
  });
}
