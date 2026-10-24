import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { CLAIMABLE_RECOVERY_RESERVE_UNITS, claimableSourceIssue, createRecoverableClaimableBalanceOperation, DEFAULT_CLAIM_WINDOW_SECONDS } from './claimablePayment.js';
import type { StellarNetworkParameters } from '../../../../packages/stellar-core/src/horizon.js';
import type { PaymentAssetChoice } from '../../../../packages/stellar-core/src/paymentAsset.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';

const SOURCE = Keypair.random().publicKey();
const DESTINATION = Keypair.random().publicKey();

const parameters: StellarNetworkParameters = {
  ledgerSequence: 1,
  ledgerClosedAt: '2026-09-03T00:00:00Z',
  baseFeeInStroops: 100,
  baseReserveInStroops: 5_000_000,
};

function account(nativeBalance = '10.0000000'): StellarAccountSnapshot {
  return {
    accountId: SOURCE,
    sequence: '1',
    subentryCount: 0,
    numSponsoring: 0,
    numSponsored: 0,
    nativeBalance,
    nativeSellingLiabilities: '0',
    balances: [{ assetType: 'native', assetCode: 'XLM', balance: nativeBalance, sellingLiabilities: '0', buyingLiabilities: '0' }],
    thresholds: { low: 1, medium: 1, high: 1 },
    signers: [],
  };
}

const xlm: PaymentAssetChoice = { key: 'native', code: 'XLM', balance: '10.0000000' };

test('recoverable claimable payment gives recipient the early window and source the inverse recovery window', () => {
  const transaction = new TransactionBuilder(new Account(SOURCE, '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(createRecoverableClaimableBalanceOperation({
      source: SOURCE,
      destination: DESTINATION,
      asset: xlm,
      amount: '2',
      claimWindowSeconds: DEFAULT_CLAIM_WINDOW_SECONDS,
    }))
    .setTimeout(60)
    .build();
  const parsed = TransactionBuilder.fromXdr(transaction.toXDR(), Networks.TESTNET);
  const operation = parsed.operations[0] as unknown as { claimants: Array<{ destination: string; predicate: { type: string; relBefore?: bigint; notPredicate?: { type: string; relBefore?: bigint } } }> };
  assert.equal(operation.claimants.length, 2);
  assert.equal(operation.claimants[0]?.destination, DESTINATION);
  assert.equal(operation.claimants[0]?.predicate.type, 'claimPredicateBeforeRelativeTime');
  assert.equal(operation.claimants[0]?.predicate.relBefore, BigInt(DEFAULT_CLAIM_WINDOW_SECONDS));
  assert.equal(operation.claimants[1]?.destination, SOURCE);
  assert.equal(operation.claimants[1]?.predicate.type, 'claimPredicateNot');
  assert.equal(operation.claimants[1]?.predicate.notPredicate?.relBefore, BigInt(DEFAULT_CLAIM_WINDOW_SECONDS));
});

test('claimable preflight reserves the balance entry plus one base reserve per claimant before allowing XLM to be sent', () => {
  assert.equal(CLAIMABLE_RECOVERY_RESERVE_UNITS, 3);
  // Current minimum = 1 XLM. The claimable balance entry plus two claimants add 1.5 XLM.
  // Fee = 0.00001 XLM, so 7.5000000 XLM is slightly too much from a 10 XLM account.
  assert.match(claimableSourceIssue(account(), xlm, '7.5000000', parameters) ?? '', /claimable balance entry/);
  assert.equal(claimableSourceIssue(account(), xlm, '7.4999900', parameters), null);
});
