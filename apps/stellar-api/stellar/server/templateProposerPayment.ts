import { isValidStellarAccountId, loadAccount } from '../../../../packages/stellar-core/src/horizon.js';
import type { ClassicPaymentAssetInput } from '../../../../packages/stellar-core/src/classicPaymentPrepare.js';
import { prepareClassicPayment } from '../../../../packages/stellar-core/src/classicPaymentPrepare.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import { authorizeTemplateProposer, ReusableTemplateServiceError } from './reusableTemplateService.js';
import type { ReusableTemplateStore } from './reusableTemplateStore.js';

function templateAsset(key: string): ClassicPaymentAssetInput {
  if (key === 'native') return { type: 'native' };
  const match = /^credit:([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(key);
  if (!match || !isValidStellarAccountId(match[2])) {
    throw new ReusableTemplateServiceError('Template asset is unsupported for delegated payments.', 400, 'invalid_template_asset');
  }
  return { type: 'credit', code: match[1], issuer: match[2] };
}

/** Only the amount and text memo are proposer-controlled. Server reconstructs
 * the source, destination, asset and lifetime from the immutable Template. */
export async function prepareTemplateProposerPayment(
  templates: ReusableTemplateStore,
  proposerAddress: string,
  network: StellarNetwork,
  input: unknown,
  options: {
    accountLoader?: typeof loadAccount;
    networkParametersLoader?: Parameters<typeof prepareClassicPayment>[1]['networkParametersLoader'];
    alternateGrant?: (templateId: string) => Promise<boolean>;
  } = {},
) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ReusableTemplateServiceError('Template payment is invalid.', 400, 'invalid_template_payment');
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['template', 'amount', 'memo'].includes(key))) {
    throw new ReusableTemplateServiceError('Only Template, amount and memo can be supplied.', 400, 'invalid_template_payment');
  }
  const template = await authorizeTemplateProposer(
    templates, proposerAddress, network, record.template, options.accountLoader ?? loadAccount,
    options.alternateGrant,
  );
  const definition = template.definition;
  if (definition.recipients.length !== 1) {
    throw new ReusableTemplateServiceError('Delegated payments require one fixed recipient.', 400, 'invalid_template_payment');
  }
  const amount = record.amount;
  const prepared = await prepareClassicPayment({
    network,
    sourceAccount: definition.source,
    payments: [{
      destination: definition.recipients[0].destination,
      amount,
      asset: templateAsset(definition.recipients[0].assetKey),
    }],
    ...(record.memo === undefined ? {} : { memo: record.memo }),
    lifetimeSeconds: definition.signingWindowSeconds,
  }, {
    ...(options.accountLoader ? { accountLoader: options.accountLoader } : {}),
    ...(options.networkParametersLoader ? { networkParametersLoader: options.networkParametersLoader } : {}),
  });
  return { prepared, templateRef: { id: template.template.id, version: template.version,
    name: template.template.name, kind: template.template.kind } as const };
}
