export interface OperationDisplayField {
  label: string;
  value: string;
  mono?: boolean;
}

export interface OperationHumanSummary {
  title: string;
  summary: string;
  fields: OperationDisplayField[];
}

type AnyRecord = Record<string, unknown>;

function record(value: unknown): AnyRecord | null {
  return value !== null && typeof value === 'object' ? value as AnyRecord : null;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return undefined;
}

function callString(target: AnyRecord, method: string): string | undefined {
  const candidate = target[method];
  if (typeof candidate !== 'function') return undefined;
  try {
    const value = candidate.call(target);
    return stringValue(value);
  } catch {
    return undefined;
  }
}

function assetLabel(value: unknown): string {
  const asset = record(value);
  if (!asset) return 'Unknown asset';

  const code = stringValue(asset.code) ?? callString(asset, 'getCode');
  const issuer = stringValue(asset.issuer) ?? callString(asset, 'getIssuer');
  if (code) return issuer ? `${code} · ${issuer}` : code.toUpperCase() === 'XLM' ? 'XLM' : code;

  const rendered = callString(asset, 'toString');
  if (rendered && rendered !== '[object Object]') return rendered === 'native' ? 'XLM' : rendered;
  return 'Unknown asset';
}

function titleFromType(type: string): string {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (value) => value.toUpperCase());
}

function field(label: string, value: unknown, mono = false): OperationDisplayField | null {
  const rendered = stringValue(value);
  return rendered === undefined || rendered === '' ? null : { label, value: rendered, mono };
}

function compact(fields: Array<OperationDisplayField | null>): OperationDisplayField[] {
  return fields.filter((item): item is OperationDisplayField => item !== null);
}

function bytesHex(value: unknown): string | undefined {
  if (!(value instanceof Uint8Array)) return undefined;
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function binaryOrString(value: unknown): string | undefined {
  return stringValue(value) ?? bytesHex(value);
}

function signerIdentity(value: unknown): string | undefined {
  const signer = record(value);
  if (!signer) return undefined;
  const candidates: Array<[string, string]> = [
    ['Ed25519', 'ed25519PublicKey'],
    ['Signed payload', 'ed25519SignedPayload'],
    ['Pre-authorized transaction', 'preAuthTx'],
    ['Hash(x)', 'sha256Hash'],
  ];
  for (const [label, key] of candidates) {
    const identity = binaryOrString(signer[key]);
    if (identity) return `${label} · ${identity}`;
  }
  return undefined;
}

function trustAuthorizationLabel(value: unknown): string {
  if (value === true || value === 1 || value === '1') return 'Authorized';
  if (value === false || value === 0 || value === '0') return 'Not authorized';
  if (value === 2 || value === '2') return 'Maintain liabilities only';
  return stringValue(value) ?? 'Unknown authorization';
}

function trustLineFlagsLabel(value: unknown): string {
  const flags = record(value);
  if (!flags) return 'No flags';
  const labels: string[] = [];
  if (flags.authorized === true) labels.push('Authorized');
  if (flags.authorized === false) labels.push('Not authorized');
  if (flags.authorizedToMaintainLiabilities === true) labels.push('Maintain liabilities');
  if (flags.authorizedToMaintainLiabilities === false) labels.push('No maintain-liabilities authorization');
  if (flags.clawbackEnabled === true) labels.push('Clawback enabled');
  if (flags.clawbackEnabled === false) labels.push('Clawback disabled');
  return labels.length > 0 ? labels.join(' · ') : 'No flag changes';
}

function assetOrPoolLabel(value: unknown): string {
  const asset = assetLabel(value);
  if (asset !== 'Unknown asset') return asset;
  const rendered = record(value) ? callString(record(value)!, 'toString') : undefined;
  return rendered && rendered !== '[object Object]' ? rendered : 'Unknown trustline asset';
}

function xdrUnionVariant(value: unknown): string | undefined {
  const union = record(value);
  if (!union) return undefined;
  const decodedType = stringValue(union.type);
  if (decodedType) return titleFromType(decodedType);
  if (typeof union.switch !== 'function') return undefined;
  try {
    const selected = union.switch.call(union);
    const selectedRecord = record(selected);
    const name = selectedRecord ? stringValue(selectedRecord.name) ?? callString(selectedRecord, 'name') : undefined;
    return name ?? stringValue(selected);
  } catch {
    return undefined;
  }
}

function claimantDestination(value: unknown): string | undefined {
  const claimant = record(value);
  return claimant ? stringValue(claimant.destination) : undefined;
}

function beforeRelativeSeconds(value: unknown): string | undefined {
  const predicate = record(value);
  if (!predicate || stringValue(predicate.type) !== 'claimPredicateBeforeRelativeTime') return undefined;
  return stringValue(predicate.relBefore);
}

function notBeforeRelativeSeconds(value: unknown): string | undefined {
  const predicate = record(value);
  if (!predicate || stringValue(predicate.type) !== 'claimPredicateNot') return undefined;
  return beforeRelativeSeconds(predicate.notPredicate);
}

function durationLabel(secondsValue: string): string {
  const seconds = Number(secondsValue);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return `${secondsValue} seconds`;
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${seconds} seconds`;
}

function summarizeSetOptions(operation: AnyRecord): OperationHumanSummary {
  const changes: string[] = [];
  const fields: OperationDisplayField[] = [];
  const numericFields: Array<[string, string]> = [
    ['Master weight', 'masterWeight'],
    ['Low threshold', 'lowThreshold'],
    ['Medium threshold', 'medThreshold'],
    ['High threshold', 'highThreshold'],
  ];

  for (const [label, key] of numericFields) {
    const value = stringValue(operation[key]);
    if (value === undefined) continue;
    changes.push(`${label.toLowerCase()} → ${value}`);
    fields.push({ label, value });
  }

  const homeDomain = stringValue(operation.homeDomain);
  if (homeDomain !== undefined) {
    changes.push('home domain');
    fields.push({ label: 'Home domain', value: homeDomain || '(clear)' });
  }

  if (operation.signer != null) {
    changes.push('signer');
    const signer = record(operation.signer);
    const identity = signerIdentity(operation.signer);
    if (identity) fields.push({ label: 'Signer', value: identity, mono: true });
    if (signer) {
      const weight = stringValue(signer.weight);
      if (weight !== undefined) fields.push({ label: 'Signer weight', value: weight });
    }
  }

  if (operation.setFlags != null) {
    changes.push('set account flags');
    fields.push({ label: 'Set flags', value: stringValue(operation.setFlags) ?? String(operation.setFlags) });
  }
  if (operation.clearFlags != null) {
    changes.push('clear account flags');
    fields.push({ label: 'Clear flags', value: stringValue(operation.clearFlags) ?? String(operation.clearFlags) });
  }
  if (operation.inflationDest != null) {
    changes.push('inflation destination');
    const destination = stringValue(operation.inflationDest);
    if (destination) fields.push({ label: 'Inflation destination', value: destination, mono: true });
  }

  return {
    title: 'Set account options',
    summary: changes.length > 0 ? changes.join(' · ') : 'Update account options',
    fields,
  };
}

export function summarizeOperation(operationValue: unknown): OperationHumanSummary {
  const operation = record(operationValue) ?? {};
  const type = stringValue(operation.type) ?? 'unknown';

  switch (type) {
    case 'payment': {
      const amount = stringValue(operation.amount) ?? '?';
      const asset = assetLabel(operation.asset);
      const destination = stringValue(operation.destination) ?? 'unknown destination';
      return {
        title: 'Payment',
        summary: `${amount} ${asset.includes(' · ') ? asset.split(' · ')[0] : asset} → ${destination}`,
        fields: compact([
          field('Amount', amount),
          { label: 'Asset', value: asset, mono: asset.includes(' · ') },
          field('Destination', destination, true),
        ]),
      };
    }
    case 'createAccount': {
      const destination = stringValue(operation.destination) ?? 'unknown destination';
      const startingBalance = stringValue(operation.startingBalance) ?? '?';
      return {
        title: 'Create account',
        summary: `Create ${destination} with ${startingBalance} XLM`,
        fields: compact([
          field('Destination', destination, true),
          field('Starting balance', `${startingBalance} XLM`),
        ]),
      };
    }
    case 'accountMerge': {
      const destination = stringValue(operation.destination) ?? 'unknown destination';
      return {
        title: 'Merge account',
        summary: `Merge remaining balance into ${destination}`,
        fields: compact([field('Destination', destination, true)]),
      };
    }
    case 'changeTrust': {
      const asset = assetLabel(operation.line);
      const limit = stringValue(operation.limit);
      return {
        title: 'Change trustline',
        summary: limit ? `${asset} · limit ${limit}` : asset,
        fields: compact([
          { label: 'Asset', value: asset, mono: asset.includes(' · ') },
          field('Limit', limit),
        ]),
      };
    }
    case 'manageSellOffer':
    case 'createPassiveSellOffer': {
      const selling = assetLabel(operation.selling);
      const buying = assetLabel(operation.buying);
      const amount = stringValue(operation.amount) ?? '?';
      const price = stringValue(operation.price) ?? '?';
      return {
        title: type === 'manageSellOffer' ? 'Manage sell offer' : 'Create passive sell offer',
        summary: `Sell ${amount} ${selling.split(' · ')[0]} for ${buying.split(' · ')[0]} @ ${price}`,
        fields: compact([
          { label: 'Selling', value: selling, mono: selling.includes(' · ') },
          { label: 'Buying', value: buying, mono: buying.includes(' · ') },
          field('Amount', amount),
          field('Price', price),
          field('Offer ID', operation.offerId),
        ]),
      };
    }
    case 'manageBuyOffer': {
      const selling = assetLabel(operation.selling);
      const buying = assetLabel(operation.buying);
      const buyAmount = stringValue(operation.buyAmount) ?? '?';
      const price = stringValue(operation.price) ?? '?';
      return {
        title: 'Manage buy offer',
        summary: `Buy ${buyAmount} ${buying.split(' · ')[0]} with ${selling.split(' · ')[0]} @ ${price}`,
        fields: compact([
          { label: 'Buying', value: buying, mono: buying.includes(' · ') },
          { label: 'Selling', value: selling, mono: selling.includes(' · ') },
          field('Buy amount', buyAmount),
          field('Price', price),
          field('Offer ID', operation.offerId),
        ]),
      };
    }
    case 'pathPaymentStrictSend': {
      const sendAsset = assetLabel(operation.sendAsset);
      const destAsset = assetLabel(operation.destAsset);
      const sendAmount = stringValue(operation.sendAmount) ?? '?';
      const destMin = stringValue(operation.destMin) ?? '?';
      const destination = stringValue(operation.destination) ?? 'unknown destination';
      return {
        title: 'Path payment · strict send',
        summary: `Send ${sendAmount} ${sendAsset.split(' · ')[0]} → at least ${destMin} ${destAsset.split(' · ')[0]}`,
        fields: compact([
          field('Destination', destination, true),
          { label: 'Send asset', value: sendAsset, mono: sendAsset.includes(' · ') },
          field('Send amount', sendAmount),
          { label: 'Destination asset', value: destAsset, mono: destAsset.includes(' · ') },
          field('Destination minimum', destMin),
          field('Path', Array.isArray(operation.path) && operation.path.length > 0 ? operation.path.map(assetLabel).join(' → ') : undefined, true),
        ]),
      };
    }
    case 'pathPaymentStrictReceive': {
      const sendAsset = assetLabel(operation.sendAsset);
      const destAsset = assetLabel(operation.destAsset);
      const sendMax = stringValue(operation.sendMax) ?? '?';
      const destAmount = stringValue(operation.destAmount) ?? '?';
      const destination = stringValue(operation.destination) ?? 'unknown destination';
      return {
        title: 'Path payment · strict receive',
        summary: `Receive ${destAmount} ${destAsset.split(' · ')[0]} · spend up to ${sendMax} ${sendAsset.split(' · ')[0]}`,
        fields: compact([
          field('Destination', destination, true),
          { label: 'Send asset', value: sendAsset, mono: sendAsset.includes(' · ') },
          field('Send maximum', sendMax),
          { label: 'Destination asset', value: destAsset, mono: destAsset.includes(' · ') },
          field('Destination amount', destAmount),
          field('Path', Array.isArray(operation.path) && operation.path.length > 0 ? operation.path.map(assetLabel).join(' → ') : undefined, true),
        ]),
      };
    }
    case 'manageData': {
      const name = stringValue(operation.name) ?? 'unknown key';
      const deleting = operation.value == null;
      const action = deleting ? 'Delete value' : 'Set value';
      return {
        title: 'Manage data',
        summary: `${name} · ${action.toLowerCase()}`,
        fields: compact([
          field('Key', name),
          field('Action', action),
          field('Value (hex)', deleting ? undefined : bytesHex(operation.value), true),
        ]),
      };
    }
    case 'bumpSequence': {
      const bumpTo = stringValue(operation.bumpTo) ?? '?';
      return {
        title: 'Bump sequence',
        summary: `Advance account sequence to ${bumpTo}`,
        fields: compact([field('Bump to', bumpTo)]),
      };
    }
    case 'createClaimableBalance': {
      const amount = stringValue(operation.amount) ?? '?';
      const asset = assetLabel(operation.asset);
      const claimants = Array.isArray(operation.claimants) ? operation.claimants : [];
      const recipient = claimantDestination(claimants[0]);
      const recoveryAccount = claimantDestination(claimants[1]);
      const recipientPredicate = record(claimants[0])?.predicate;
      const recoveryPredicate = record(claimants[1])?.predicate;
      const recipientSeconds = beforeRelativeSeconds(recipientPredicate);
      const recoverySeconds = notBeforeRelativeSeconds(recoveryPredicate);
      const recoverable = claimants.length === 2
        && Boolean(recipient)
        && Boolean(recoveryAccount)
        && Boolean(recipientSeconds)
        && recipientSeconds === recoverySeconds;
      if (recoverable && recipient && recoveryAccount && recipientSeconds) {
        const window = durationLabel(recipientSeconds);
        return {
          title: 'Claimable payment',
          summary: `${amount} ${asset.split(' · ')[0]} · claim for ${window}, then recover`,
          fields: compact([
            field('Amount', amount),
            { label: 'Asset', value: asset, mono: asset.includes(' · ') },
            field('Recipient', recipient, true),
            field('Recipient condition', `Before ${window} after creation`),
            field('Recovery account', recoveryAccount, true),
            field('Recovery condition', `At or after ${window} after creation`),
            field('Claim window seconds', recipientSeconds),
          ]),
        };
      }
      const claimantFields = claimants.flatMap((claimant, index) => {
        const claimantRecord = record(claimant);
        const destination = claimantDestination(claimant);
        const predicate = claimantRecord?.predicate;
        const before = beforeRelativeSeconds(predicate);
        const after = notBeforeRelativeSeconds(predicate);
        const condition = before
          ? `Before ${durationLabel(before)} after creation`
          : after
            ? `At or after ${durationLabel(after)} after creation`
            : 'Custom claim condition';
        return compact([
          field(`Claimant ${index + 1}`, destination, true),
          field(`Claimant ${index + 1} condition`, condition),
        ]);
      });
      return {
        title: 'Claimable payment',
        summary: `${amount} ${asset.split(' · ')[0]} · ${claimants.length} claimant${claimants.length === 1 ? '' : 's'}`,
        fields: compact([
          field('Amount', amount),
          { label: 'Asset', value: asset, mono: asset.includes(' · ') },
          ...claimantFields,
        ]),
      };
    }
    case 'allowTrust': {
      const trustor = stringValue(operation.trustor) ?? 'unknown trustor';
      const assetCode = stringValue(operation.assetCode) ?? 'unknown asset';
      const authorization = trustAuthorizationLabel(operation.authorize);
      return {
        title: 'Allow trust',
        summary: `${assetCode} for ${trustor} · ${authorization}`,
        fields: compact([
          field('Trustor', trustor, true),
          field('Asset code', assetCode),
          field('Authorization', authorization),
        ]),
      };
    }
    case 'claimClaimableBalance': {
      const balanceId = stringValue(operation.balanceId) ?? 'unknown balance';
      return {
        title: 'Claim claimable balance',
        summary: 'Claim a Stellar claimable balance',
        fields: compact([field('Balance ID', balanceId, true)]),
      };
    }
    case 'beginSponsoringFutureReserves': {
      const sponsoredId = stringValue(operation.sponsoredId) ?? 'unknown account';
      return {
        title: 'Begin reserve sponsorship',
        summary: `Sponsor future reserves for ${sponsoredId}`,
        fields: compact([field('Sponsored account', sponsoredId, true)]),
      };
    }
    case 'endSponsoringFutureReserves':
      return {
        title: 'End reserve sponsorship',
        summary: 'End the active future-reserve sponsorship scope',
        fields: [],
      };
    case 'revokeAccountSponsorship': {
      const account = stringValue(operation.account) ?? 'unknown account';
      return {
        title: 'Revoke account sponsorship',
        summary: `Remove sponsorship from ${account}`,
        fields: compact([field('Account', account, true)]),
      };
    }
    case 'revokeTrustlineSponsorship': {
      const account = stringValue(operation.account) ?? 'unknown account';
      const asset = assetOrPoolLabel(operation.asset);
      return {
        title: 'Revoke trustline sponsorship',
        summary: `Remove trustline sponsorship for ${account}`,
        fields: compact([
          field('Account', account, true),
          field('Asset / pool', asset, true),
        ]),
      };
    }
    case 'revokeOfferSponsorship': {
      const seller = stringValue(operation.seller) ?? 'unknown seller';
      const offerId = stringValue(operation.offerId) ?? 'unknown offer';
      return {
        title: 'Revoke offer sponsorship',
        summary: `Remove sponsorship from offer ${offerId}`,
        fields: compact([
          field('Seller', seller, true),
          field('Offer ID', offerId),
        ]),
      };
    }
    case 'revokeDataSponsorship': {
      const account = stringValue(operation.account) ?? 'unknown account';
      const name = stringValue(operation.name) ?? 'unknown data key';
      return {
        title: 'Revoke data sponsorship',
        summary: `Remove sponsorship from data entry ${name}`,
        fields: compact([
          field('Account', account, true),
          field('Data key', name),
        ]),
      };
    }
    case 'revokeClaimableBalanceSponsorship': {
      const balanceId = stringValue(operation.balanceId) ?? 'unknown balance';
      return {
        title: 'Revoke claimable-balance sponsorship',
        summary: 'Remove sponsorship from a claimable balance',
        fields: compact([field('Balance ID', balanceId, true)]),
      };
    }
    case 'revokeLiquidityPoolSponsorship': {
      const poolId = stringValue(operation.liquidityPoolId) ?? 'unknown pool';
      return {
        title: 'Revoke liquidity-pool sponsorship',
        summary: 'Remove sponsorship from a liquidity pool',
        fields: compact([field('Liquidity pool ID', poolId, true)]),
      };
    }
    case 'revokeSignerSponsorship': {
      const account = stringValue(operation.account) ?? 'unknown account';
      const signer = signerIdentity(operation.signer) ?? 'unknown signer';
      return {
        title: 'Revoke signer sponsorship',
        summary: `Remove signer sponsorship from ${account}`,
        fields: compact([
          field('Account', account, true),
          field('Signer', signer, true),
        ]),
      };
    }
    case 'clawbackClaimableBalance': {
      const balanceId = stringValue(operation.balanceId) ?? 'unknown balance';
      return {
        title: 'Claw back claimable balance',
        summary: 'Claw back an issuer-sponsored claimable balance',
        fields: compact([field('Balance ID', balanceId, true)]),
      };
    }
    case 'setTrustLineFlags': {
      const trustor = stringValue(operation.trustor) ?? 'unknown trustor';
      const asset = assetLabel(operation.asset);
      const flags = trustLineFlagsLabel(operation.flags);
      return {
        title: 'Set trustline flags',
        summary: `${asset.split(' · ')[0]} for ${trustor} · ${flags}`,
        fields: compact([
          field('Trustor', trustor, true),
          { label: 'Asset', value: asset, mono: asset.includes(' · ') },
          field('Flags', flags),
        ]),
      };
    }
    case 'liquidityPoolDeposit': {
      const poolId = stringValue(operation.liquidityPoolId) ?? 'unknown pool';
      return {
        title: 'Deposit to liquidity pool',
        summary: `Deposit liquidity into pool ${poolId}`,
        fields: compact([
          field('Liquidity pool ID', poolId, true),
          field('Maximum amount A', operation.maxAmountA),
          field('Maximum amount B', operation.maxAmountB),
          field('Minimum price', operation.minPrice),
          field('Maximum price', operation.maxPrice),
        ]),
      };
    }
    case 'liquidityPoolWithdraw': {
      const poolId = stringValue(operation.liquidityPoolId) ?? 'unknown pool';
      return {
        title: 'Withdraw from liquidity pool',
        summary: `Withdraw ${stringValue(operation.amount) ?? '?'} pool shares`,
        fields: compact([
          field('Liquidity pool ID', poolId, true),
          field('Pool shares', operation.amount),
          field('Minimum amount A', operation.minAmountA),
          field('Minimum amount B', operation.minAmountB),
        ]),
      };
    }
    case 'inflation':
      return {
        title: 'Inflation',
        summary: 'Run the legacy Stellar inflation operation',
        fields: [],
      };
    case 'extendFootprintTtl': {
      const extendTo = stringValue(operation.extendTo) ?? '?';
      return {
        title: 'Extend Soroban footprint TTL',
        summary: `Extend the transaction footprint to ledger ${extendTo}`,
        fields: compact([field('Extend to ledger', extendTo)]),
      };
    }
    case 'restoreFootprint':
      return {
        title: 'Restore Soroban footprint',
        summary: 'Restore archived Soroban ledger entries in this transaction footprint',
        fields: [],
      };
    case 'invokeHostFunction': {
      const hostFunction = xdrUnionVariant(operation.func) ?? 'Soroban host function';
      const authCount = Array.isArray(operation.auth) ? operation.auth.length : 0;
      return {
        title: 'Invoke Soroban host function',
        summary: `${hostFunction}${authCount > 0 ? ` · ${authCount} authorization entr${authCount === 1 ? 'y' : 'ies'}` : ''}`,
        fields: compact([
          field('Host function', hostFunction),
          field('Authorization entries', String(authCount)),
        ]),
      };
    }
    case 'clawback': {
      const amount = stringValue(operation.amount) ?? '?';
      const asset = assetLabel(operation.asset);
      const from = stringValue(operation.from) ?? 'unknown account';
      return {
        title: 'Claw back asset',
        summary: `${amount} ${asset.split(' · ')[0]} from ${from}`,
        fields: compact([
          field('From', from, true),
          field('Amount', amount),
          { label: 'Asset', value: asset, mono: asset.includes(' · ') },
        ]),
      };
    }
    case 'setOptions':
      return summarizeSetOptions(operation);
    default:
      return {
        title: titleFromType(type),
        summary: 'Inspect authorization and raw XDR before signing.',
        fields: [],
      };
  }
}
