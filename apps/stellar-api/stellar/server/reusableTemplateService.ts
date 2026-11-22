import { randomBytes } from 'node:crypto';
import { isValidStellarAccountId, loadAccount } from '../../../../packages/stellar-core/src/horizon.js';
import type { StellarAccountSnapshot } from '../../../../packages/stellar-core/src/types.js';
import type {
  ReusablePaymentTemplateDefinitionV1,
  ReusableTemplateKind,
  ReusableTemplateRef,
  ReusableTemplateSummary,
} from '../../../../packages/stellar-core/src/reusableTemplate.js';
import { isTransactionLifetimeSeconds } from '../../../../packages/stellar-core/src/transactionPreferences.js';
import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';
import type {
  ReusableTemplateStore,
  StoredReusableTemplateVersion,
} from './reusableTemplateStore.js';

const TEMPLATE_ID = /^tpl_[A-Za-z0-9_-]{16}$/;
const MAX_NAME_LENGTH = 80;
const MAX_RECIPIENTS = 100;
const MAX_ASSET_KEY_LENGTH = 128;

export class ReusableTemplateServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ReusableTemplateServiceError';
  }
}

export function createReusableTemplateId(): string {
  return `tpl_${randomBytes(12).toString('base64url')}`;
}

function parseNetwork(value: unknown): StellarNetwork {
  if (value === 'public' || value === 'testnet') return value;
  throw new ReusableTemplateServiceError('Network must be public or testnet.', 400, 'invalid_network');
}

function parseName(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!normalized || normalized.length > MAX_NAME_LENGTH) {
    throw new ReusableTemplateServiceError('Template name must be between 1 and 80 characters.', 400, 'invalid_template_name');
  }
  return normalized;
}

function parseKind(value: unknown): ReusableTemplateKind {
  if (value === 'payment' || value === 'batch_payment') return value;
  throw new ReusableTemplateServiceError('Template kind must be payment or batch_payment.', 400, 'invalid_template_kind');
}

function parseDefinition(
  value: unknown,
  templateKind: ReusableTemplateKind,
): ReusablePaymentTemplateDefinitionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReusableTemplateServiceError('Template definition is invalid.', 400, 'invalid_template_definition');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new ReusableTemplateServiceError('Template definition version is unsupported.', 400, 'invalid_template_definition');
  }
  const source = typeof record.source === 'string' ? record.source.trim() : '';
  if (!isValidStellarAccountId(source)) {
    throw new ReusableTemplateServiceError('Template source must be a valid Stellar G address.', 400, 'invalid_template_source');
  }
  if (!Array.isArray(record.recipients) || record.recipients.length < 1 || record.recipients.length > MAX_RECIPIENTS) {
    throw new ReusableTemplateServiceError('Template must contain between 1 and 100 recipients.', 400, 'invalid_template_recipients');
  }
  const recipients = record.recipients.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ReusableTemplateServiceError(`Recipient ${index + 1} is invalid.`, 400, 'invalid_template_recipient');
    }
    const recipient = value as Record<string, unknown>;
    const destination = typeof recipient.destination === 'string' ? recipient.destination.trim() : '';
    const assetKey = typeof recipient.assetKey === 'string' ? recipient.assetKey.trim() : '';
    if (!isValidStellarAccountId(destination)) {
      throw new ReusableTemplateServiceError(`Recipient ${index + 1} must be a valid Stellar G address.`, 400, 'invalid_template_recipient');
    }
    if (!assetKey || assetKey.length > MAX_ASSET_KEY_LENGTH) {
      throw new ReusableTemplateServiceError(`Recipient ${index + 1} asset is invalid.`, 400, 'invalid_template_recipient');
    }
    return { destination, assetKey };
  });
  if (templateKind === 'payment' && recipients.length !== 1) {
    throw new ReusableTemplateServiceError('Payment templates must contain exactly one recipient.', 400, 'invalid_template_recipients');
  }
  if (templateKind === 'batch_payment' && recipients.length < 2) {
    throw new ReusableTemplateServiceError('Batch payment templates must contain at least two recipients.', 400, 'invalid_template_recipients');
  }
  if (typeof record.signingWindowSeconds !== 'number' || !isTransactionLifetimeSeconds(record.signingWindowSeconds)) {
    throw new ReusableTemplateServiceError('Template signing window is invalid.', 400, 'invalid_template_signing_window');
  }
  if (record.autoRemind !== undefined && typeof record.autoRemind !== 'boolean') {
    throw new ReusableTemplateServiceError('Automatic reminder setting must be true or false.', 400, 'invalid_template_reminder');
  }
  return {
    version: 1,
    source,
    recipients,
    signingWindowSeconds: record.signingWindowSeconds,
    ...(record.autoRemind === true ? { autoRemind: true as const } : {}),
  };
}

function publicTemplate(value: StoredReusableTemplateVersion): ReusableTemplateSummary {
  return {
    id: value.template.id,
    ownerAddress: value.template.ownerAddress,
    network: value.template.network,
    name: value.template.name,
    kind: value.template.kind,
    currentVersion: value.template.currentVersion,
    definition: value.definition,
    createdAt: value.template.createdAt,
    updatedAt: value.template.updatedAt,
  };
}

export async function createReusableTemplate(
  store: ReusableTemplateStore,
  ownerAddress: string,
  input: {
    network: unknown;
    name: unknown;
    kind: unknown;
    definition: unknown;
  },
  options: { now?: Date; idFactory?: () => string } = {},
): Promise<ReusableTemplateSummary> {
  if (!isValidStellarAccountId(ownerAddress)) {
    throw new ReusableTemplateServiceError('Template owner is invalid.', 400, 'invalid_template_owner');
  }
  const templateNetwork = parseNetwork(input.network);
  const templateName = parseName(input.name);
  const templateKind = parseKind(input.kind);
  const templateDefinition = parseDefinition(input.definition, templateKind);
  const createdAt = (options.now ?? new Date()).toISOString();
  const id = options.idFactory?.() ?? createReusableTemplateId();
  if (!TEMPLATE_ID.test(id)) {
    throw new ReusableTemplateServiceError('Template id is invalid.', 500, 'invalid_template_id');
  }

  const template = {
    id,
    ownerAddress,
    network: templateNetwork,
    name: templateName,
    kind: templateKind,
    currentVersion: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const version = {
    template,
    version: 1,
    definition: templateDefinition,
    createdAt,
  };
  await store.createTemplate(template, version);
  return publicTemplate(version);
}

export async function listReusableTemplates(
  store: ReusableTemplateStore,
  ownerAddress: string,
  requestedNetwork: unknown,
): Promise<ReusableTemplateSummary[]> {
  if (!isValidStellarAccountId(ownerAddress)) {
    throw new ReusableTemplateServiceError('Template owner is invalid.', 400, 'invalid_template_owner');
  }
  const templateNetwork = parseNetwork(requestedNetwork);
  return (await store.listTemplates(ownerAddress, templateNetwork)).map(publicTemplate);
}

export async function resolveReusableTemplateReference(
  store: ReusableTemplateStore,
  ownerAddress: string,
  requestedNetwork: StellarNetwork,
  value: unknown,
): Promise<ReusableTemplateRef> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReusableTemplateServiceError('Template reference is invalid.', 400, 'invalid_template_reference');
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const version = typeof record.version === 'number' && Number.isInteger(record.version) ? record.version : 0;
  if (!TEMPLATE_ID.test(id) || version < 1) {
    throw new ReusableTemplateServiceError('Template reference is invalid.', 400, 'invalid_template_reference');
  }
  const stored = await store.getTemplateVersion(id, version);
  if (
    !stored
    || stored.template.ownerAddress !== ownerAddress
    || stored.template.network !== requestedNetwork
    || stored.template.archivedAt
  ) {
    throw new ReusableTemplateServiceError('Template is unavailable for this signer and network.', 404, 'template_not_found');
  }
  return {
    id,
    version,
    name: stored.template.name,
    kind: stored.template.kind,
  };
}

/** A delegated wallet can only initiate payments while the Template owner's on-chain
 * signer relationship is current. A Template grant never grants a transaction signature. */
export async function requireTemplateOwnerSigner(
  record: StoredReusableTemplateVersion,
  accountLoader: typeof loadAccount = loadAccount,
): Promise<void> {
  let account: StellarAccountSnapshot;
  try {
    account = await accountLoader(record.definition.source, record.template.network);
  } catch {
    throw new ReusableTemplateServiceError("Unable to verify the Template owner's current signing authority.", 503, 'template_owner_policy_unavailable');
  }
  if (!account.signers.some((signer) =>
    signer.key === record.template.ownerAddress && signer.type === 'ed25519_public_key' && signer.weight > 0)) {
    throw new ReusableTemplateServiceError(
      'The Template owner is no longer an active signer for its Treasury.',
      403,
      'template_owner_signer_required',
    );
  }
}

export async function authorizeTemplateProposer(
  store: ReusableTemplateStore,
  proposer: string,
  network: StellarNetwork,
  reference: unknown,
  accountLoader: typeof loadAccount = loadAccount,
  alternateGrant?: (templateId: string) => Promise<boolean>,
): Promise<StoredReusableTemplateVersion> {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new ReusableTemplateServiceError('Valid Template id and version are required.', 400, 'invalid_template_reference');
  }
  const { id, version } = reference as { id?: unknown; version?: unknown };
  if (typeof id !== 'string' || !TEMPLATE_ID.test(id)
    || typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ReusableTemplateServiceError('Valid Template id and version are required.', 400, 'invalid_template_reference');
  }
  const record = await store.getTemplateVersion(id, version);
  if (!record || record.template.network !== network || record.template.archivedAt
    || record.template.currentVersion !== version || record.template.kind !== 'payment') {
    throw new ReusableTemplateServiceError('This payment Template is not available.', 404, 'template_not_found');
  }
  const granted = (alternateGrant && await alternateGrant(id))
    || (Boolean(proposer) && Boolean(await store.hasActiveGrant?.(id, proposer)));
  if (!granted) {
    throw new ReusableTemplateServiceError('This wallet has no active permission to propose from the Template.', 403, 'template_proposer_not_authorized');
  }
  await requireTemplateOwnerSigner(record, accountLoader);
  return record;
}

export async function updateTemplateProposer(
  store: ReusableTemplateStore,
  owner: string,
  network: StellarNetwork,
  templateId: unknown,
  proposerAddress: unknown,
  action: unknown,
  accountLoader: typeof loadAccount = loadAccount,
): Promise<string[]> {
  const id = typeof templateId === 'string' ? templateId : '';
  const proposer = typeof proposerAddress === 'string' ? proposerAddress.trim() : '';
  if (!TEMPLATE_ID.test(id) || !isValidStellarAccountId(proposer)
    || proposer === owner || (action !== 'grant' && action !== 'revoke')) {
    throw new ReusableTemplateServiceError('Choose a different valid G-address and a grant or revoke action.', 400, 'invalid_template_proposer');
  }
  const record = await store.getTemplateVersion(id, 1);
  if (!record || record.template.ownerAddress !== owner || record.template.network !== network
    || record.template.archivedAt || record.template.kind !== 'payment') {
    throw new ReusableTemplateServiceError('Payment Template not found for this wallet.', 404, 'template_not_found');
  }
  await requireTemplateOwnerSigner(record, accountLoader);
  if (!store.grantProposer || !store.revokeProposer || !store.listProposers) {
    throw new ReusableTemplateServiceError('Template grants are not available.', 503, 'template_grants_unavailable');
  }
  if (action === 'grant') await store.grantProposer(id, proposer, owner);
  else await store.revokeProposer(id, proposer, owner);
  return store.listProposers(id);
}

/** The owner sees grants; a proposer sees only Templates granted to their wallet. */
export async function listWalletTemplates(
  store: ReusableTemplateStore,
  address: string,
  network: StellarNetwork,
): Promise<ReusableTemplateSummary[]> {
  const owned = await store.listTemplates(address, network);
  const delegated = await store.listGrantedTemplates?.(address, network) ?? [];
  const ownedIds = new Set(owned.map((item) => item.template.id));
  return [
    ...await Promise.all(owned.map(async (item) => ({
      ...publicTemplate(item),
      proposerAddresses: await store.listProposers?.(item.template.id) ?? [],
    }))),
    ...delegated.filter((item) => !ownedIds.has(item.template.id) && item.template.kind === 'payment')
      .map(publicTemplate),
  ];
}
