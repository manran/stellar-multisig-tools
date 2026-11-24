import assert from 'node:assert/strict';
import { Account, Address, Asset, BASE_FEE, Contract, Keypair, Networks, StrKey, TransactionBuilder, nativeToScVal } from '@stellar/stellar-sdk/base';
import { inspectTransactionXdr } from '../../packages/stellar-core/src/transactionXdr.js';
import { loadAccount } from '../../packages/stellar-core/src/horizon.js';
import { simulateSorobanTransaction } from '../../packages/stellar-core/src/sorobanRpc.js';

// Explicit, isolated Testnet-only RPC smoke. Never submit the simulated payment.
async function main() {
  assert.ok(process.argv.includes('--live'), 'Pass --live to create a disposable Testnet account and simulate a transfer.');
  const horizon = await fetch('https://horizon-testnet.stellar.org/', { signal: AbortSignal.timeout(15000) });
  assert.ok(horizon.ok);
  const runtime = await horizon.json() as { current_protocol_version: number };
  assert.ok(runtime.current_protocol_version >= 30, 'Testnet must support CAP-84.');

  const sender = Keypair.random();
  const funded = await fetch('https://friendbot.stellar.org/?addr=' + encodeURIComponent(sender.publicKey()), { signal: AbortSignal.timeout(30000) });
  assert.ok(funded.ok, 'Friendbot did not fund the disposable account');
  const account = await loadAccount(sender.publicKey(), 'testnet');
  const sac = Asset.native().contractId(Networks.TESTNET);
  // Use the known native asset contract address as a fixture destination.
  // This is a simulation only: no funds are sent to the contract.
  const muxedId = 18446744073709551615n;
  const rawId = Buffer.alloc(8);
  rawId.writeBigUInt64BE(muxedId);
  const destination = Address.muxedContract(Buffer.concat([StrKey.decodeContract(sac), rawId])).toString();
  const tx = new TransactionBuilder(new Account(sender.publicKey(), account.sequence), {
    fee: BASE_FEE, networkPassphrase: Networks.TESTNET,
  }).addOperation(new Contract(sac).call('transfer',
    Address.fromString(sender.publicKey()).toScVal(),
    Address.fromString(destination).toScVal(),
    nativeToScVal(10_000_000n, { type: 'i128' }),
  )).setTimeout(180).build();

  const result = await simulateSorobanTransaction({
    envelopeXdr: tx.toXdr(), network: 'testnet', endpointUrl: 'https://soroban-testnet.stellar.org/',
  });
  assert.ok(!result.restoreRequired && result.assembledXdr, 'RPC did not produce a ready simulation');
  const reviewed = inspectTransactionXdr(result.assembledXdr, 'testnet');
  assert.equal(reviewed.operations[0].soroban?.contractCall?.argumentPreviews[1], JSON.stringify(destination));
  const event = result.effects.events.find((item) => item.topics.some((topic) => topic.includes('transfer'))
    && item.data.includes('to_muxed_id'));
  assert.ok(event, 'Missing CAP-84 transfer destination event');
  assert.ok(event.data.includes(String(muxedId)), 'Multiplexing ID was lost in event review');
  console.log(JSON.stringify({
    protocol: runtime.current_protocol_version, latestLedger: result.latestLedger,
    destination, muxedId: String(muxedId), event: event.data,
    authorizationEntries: result.authorizationEntries.length,
    simulatedOnly: true,
  }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
