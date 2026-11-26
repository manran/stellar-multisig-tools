import { Account, Networks, TransactionBuilder, scValToNative } from '@stellar/stellar-sdk/base';
import { Api, Server } from '@stellar/stellar-sdk/rpc';
import { Client } from '@stellar/stellar-sdk/contract';
import { contractCallOperation, describeContractSpec } from '../../../../packages/stellar-core/src/contractSpec.js';
import { enrichSorobanCallSummary, inspectSorobanHostFunctionXdr } from '../../../../packages/stellar-core/src/sorobanInspection.js';
import { stellarRpcUrl } from '../../../../packages/stellar-core/src/sorobanRpc.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { configuredSorobanPlanningSource } from './sorobanIntentConfig.js';

type Metadata = { symbol: string; decimals: number; observedLedger: number };
type InterfaceMetadata = { methods: ReturnType<typeof describeContractSpec>; token?: Metadata };
const cache = new Map<string, { expiresAt: number; pending: Promise<InterfaceMetadata | null> }>();

async function loadMetadata(contractId: string, network: StellarNetwork): Promise<InterfaceMetadata | null> {
  const server = new Server(stellarRpcUrl(network), { timeout: 1800 });
  const networkPassphrase = network === 'testnet' ? Networks.TESTNET : Networks.PUBLIC;
  const client = await Client.from({ contractId, rpcUrl: stellarRpcUrl(network), networkPassphrase, server });
  const methods = describeContractSpec(client.spec);
  const has = (name: string, output: string) => methods.some(method =>
    method.name === name && method.inputs.length === 0 && method.outputs.length === 1 && method.outputs[0] === output);
  if (!has('decimals', 'U32') || !has('symbol', 'String')) return { methods };
  try {
    const source = configuredSorobanPlanningSource(network);
    const account = await server.getAccount(source);
    const read = async (name: string) => {
      const tx = new TransactionBuilder(new Account(source, account.sequenceNumber()), { fee: '100', networkPassphrase })
        .addOperation(contractCallOperation(contractId, name, [])).setTimeout(30).build();
      const sim = await server.simulateTransaction(tx);
      if (!Api.isSimulationSuccess(sim) || Api.isSimulationRestore(sim) || !sim.result
        || sim.result.auth.length !== 0 || (sim.stateChanges?.length ?? 0) !== 0) throw new Error('Not a read-only metadata simulation');
      return { value: scValToNative(sim.result.retval), ledger: sim.latestLedger };
    };
    const [decimals, symbol] = await Promise.all([read('decimals'), read('symbol')]);
    if (typeof decimals.value === 'number' && typeof symbol.value === 'string'
      && decimals.ledger === symbol.ledger) return { methods, token: { symbol: symbol.value, decimals: decimals.value, observedLedger: decimals.ledger } };
  } catch { /* Keep ABI names if metadata is unavailable. */ }
  return { methods };
}

export async function inspectSorobanReviewMetadata(encoded: string, network: StellarNetwork) {
  const base = inspectSorobanHostFunctionXdr(encoded, network);
  if (!base || base.nativeXlmTransfer) return base;
  const key = network + ':' + base.contractAddress;
  let entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    let timer: ReturnType<typeof setTimeout>;
    const pending = Promise.race([
      loadMetadata(base.contractAddress, network).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 4500); }),
    ]).finally(() => clearTimeout(timer));
    entry = { expiresAt: Date.now() + 300_000, pending };
    cache.set(key, entry);
  }
  const metadata = await entry.pending;
  return metadata ? enrichSorobanCallSummary(encoded, network, metadata.methods, metadata.token) : base;
}
