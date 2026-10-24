import { Asset } from '@stellar/stellar-sdk/base';
import { stellarAmountToStroops, stroopsToStellarAmount } from './reserve.js';
import type { StellarAccountSnapshot, StellarBalance } from './types.js';

export interface PaymentAssetChoice {
  key: string;
  code: string;
  issuer?: string;
  balance: string;
}

function keyFor(code: string, issuer?: string) {
  return issuer ? `credit:${code}:${issuer}` : 'native';
}

function isPaymentBalance(balance: StellarBalance): boolean {
  if (balance.assetType === 'native') return true;
  return (balance.assetType === 'credit_alphanum4' || balance.assetType === 'credit_alphanum12')
    && Boolean(balance.assetCode)
    && Boolean(balance.assetIssuer);
}

export function paymentAssetChoices(account: StellarAccountSnapshot | null): PaymentAssetChoice[] {
  if (!account) return [{ key: 'native', code: 'XLM', balance: '0' }];
  const balances = account.balances ?? [];
  const choices = balances
    .filter(isPaymentBalance)
    .map((balance): PaymentAssetChoice => ({
      key: keyFor(balance.assetCode, balance.assetIssuer),
      code: balance.assetCode,
      issuer: balance.assetIssuer,
      balance: balance.balance,
    }));
  if (!choices.some((choice) => choice.key === 'native')) {
    choices.unshift({ key: 'native', code: 'XLM', balance: account.nativeBalance ?? '0' });
  }
  return choices;
}

export function stellarAssetForChoice(choice: PaymentAssetChoice): Asset {
  return choice.issuer ? new Asset(choice.code, choice.issuer) : Asset.native();
}

export function paymentDestinationIssue(
  choice: PaymentAssetChoice,
  destinationId: string,
  destination: StellarAccountSnapshot | null,
  amount?: string,
): string | null {
  if (!choice.issuer) return null;
  if (!destination) {
    return `This destination account does not exist. Create it with XLM first, then add a ${choice.code} trustline before sending ${choice.code}. MultiSig Tools will not turn this payment into a different transaction automatically.`;
  }
  if (destinationId === choice.issuer) return null;
  const trustline = destination.balances?.find((balance) =>
    (balance.assetType === 'credit_alphanum4' || balance.assetType === 'credit_alphanum12')
    && balance.assetCode === choice.code
    && balance.assetIssuer === choice.issuer,
  );
  if (!trustline) {
    return `The destination account does not have a ${choice.code} trustline for this issuer. Add the trustline before sending this asset.`;
  }
  if (trustline.authorized === false) {
    return `The destination's ${choice.code} trustline is not authorized to receive this asset.`;
  }
  if (amount && trustline.limit) {
    try {
      const receivingCapacity = stellarAmountToStroops(trustline.limit)
        - stellarAmountToStroops(trustline.balance)
        - stellarAmountToStroops(trustline.buyingLiabilities);
      if (stellarAmountToStroops(amount) > receivingCapacity) {
        const available = stroopsToStellarAmount(receivingCapacity > 0n ? receivingCapacity : 0n);
        return `The destination's ${choice.code} trustline can currently receive at most ${available} ${choice.code} after balance and buying liabilities.`;
      }
    } catch {
      // Let Stellar remain authoritative if Horizon returned malformed optional limit data.
    }
  }
  return null;
}
