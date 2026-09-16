import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk/base';
import type { ServiceCallerProvenance } from '../src/stellar/coordinationActorTypes.js';
import type { StellarNetwork } from '../src/stellar/types.js';

const INTEGRATION_KEY_PREFIX = 'msi';
const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const METHOD_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const MAX_LABEL_CHARS = 80;

export interface ConfiguredIntegrationContractScope {
  contractId: string;
  methods: string[];
}

export interface ConfiguredIntegrationCredential {
  serviceId: string;
  label: string;
  secretHash: string;
  networks: StellarNetwork[];
  classicSourceAccounts: string[];
  classicExternalExecutionSourceAccounts: string[];
  sorobanContracts: ConfiguredIntegrationContractScope[];
  sorobanExecutionAccounts: string[];
  sorobanDefaultExecutor?: string;
}

export class IntegrationCredentialServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'IntegrationCredentialServiceError';
  }
}

function configError(message = 'Integration credential configuration is invalid.'): never {
  throw new IntegrationCredentialServiceError(message, 503, 'integration_credential_config_invalid');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stringArray(value: unknown, validate: (item: string) => boolean): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) configError();
  const items = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (items.some((item) => !validate(item))) configError();
  return [...new Set(items)].sort();
}

function normalizeContracts(value: unknown): ConfiguredIntegrationContractScope[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) configError();
  const byContract = new Map<string, Set<string>>();
  for (const item of value) {
    if (!item || typeof item !== 'object') configError();
    const record = item as Record<string, unknown>;
    const contractId = typeof record.contractId === 'string' ? record.contractId.trim() : '';
    const methods = stringArray(record.methods, (method) => METHOD_PATTERN.test(method));
    if (!StrKey.isValidContract(contractId) || methods.length === 0) configError();
    const existing = byContract.get(contractId) ?? new Set<string>();
    for (const method of methods) existing.add(method);
    byContract.set(contractId, existing);
  }
  return [...byContract.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([contractId, methods]) => ({ contractId, methods: [...methods].sort() }));
}

function normalizeConfiguredCredential(value: unknown): ConfiguredIntegrationCredential {
  if (!value || typeof value !== 'object') configError();
  const record = value as Record<string, unknown>;
  const serviceId = typeof record.serviceId === 'string' ? record.serviceId.trim().toLowerCase() : '';
  const label = typeof record.label === 'string' ? record.label.trim().replace(/\s+/g, ' ') : '';
  const secretHash = typeof record.secretHash === 'string' ? record.secretHash.trim().toLowerCase() : '';
  const networks = stringArray(record.networks, (network) => network === 'public' || network === 'testnet') as StellarNetwork[];
  const classicSourceAccounts = stringArray(record.classicSourceAccounts, StrKey.isValidEd25519PublicKey);
  const classicExternalExecutionSourceAccounts = stringArray(record.classicExternalExecutionSourceAccounts, StrKey.isValidEd25519PublicKey);
  const sorobanContracts = normalizeContracts(record.sorobanContracts);
  const sorobanExecutionAccounts = stringArray(record.sorobanExecutionAccounts, StrKey.isValidEd25519PublicKey);
  const sorobanDefaultExecutor = typeof record.sorobanDefaultExecutor === 'string' ? record.sorobanDefaultExecutor.trim() : '';
  if (sorobanDefaultExecutor && !StrKey.isValidEd25519PublicKey(sorobanDefaultExecutor)) configError();
  if (!SERVICE_ID_PATTERN.test(serviceId) || !label || [...label].length > MAX_LABEL_CHARS || !SHA256_PATTERN.test(secretHash)) configError();
  if (networks.length === 0 || (classicSourceAccounts.length === 0 && sorobanContracts.length === 0)) {
    configError('Integration credential must allow at least one network and one Classic account or Soroban contract.');
  }
  if (classicExternalExecutionSourceAccounts.some((accountId) => !classicSourceAccounts.includes(accountId))) {
    configError('Classic external execution accounts must also be present in classicSourceAccounts.');
  }
  if (sorobanExecutionAccounts.length > 0 && sorobanContracts.length === 0) configError();
  if (sorobanDefaultExecutor && !sorobanExecutionAccounts.includes(sorobanDefaultExecutor)) {
    configError('Soroban default executor must also be present in sorobanExecutionAccounts.');
  }
  return {
    serviceId,
    label,
    secretHash,
    networks,
    classicSourceAccounts,
    classicExternalExecutionSourceAccounts,
    sorobanContracts,
    sorobanExecutionAccounts,
    ...(sorobanDefaultExecutor ? { sorobanDefaultExecutor } : {}),
  };
}

export function configuredIntegrationCredentials(
  raw = process.env.MULTISIG_INTEGRATION_CREDENTIALS_JSON,
): ConfiguredIntegrationCredential[] {
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { configError(); }
  if (!Array.isArray(parsed)) configError();
  const credentials = parsed.map(normalizeConfiguredCredential);
  if (new Set(credentials.map((item) => item.serviceId)).size !== credentials.length) {
    configError('Integration credential service ids must be unique.');
  }
  return credentials;
}

function credentialParts(value: string): { serviceId: string; apiKey: string } {
  const apiKey = value.trim();
  const marker = `${INTEGRATION_KEY_PREFIX}_`;
  if (!apiKey.startsWith(marker)) {
    throw new IntegrationCredentialServiceError('Invalid Integration credential.', 401, 'invalid_integration_credential');
  }
  const separator = apiKey.indexOf('_', marker.length);
  if (separator < 0) {
    throw new IntegrationCredentialServiceError('Invalid Integration credential.', 401, 'invalid_integration_credential');
  }
  const serviceId = apiKey.slice(marker.length, separator).toLowerCase();
  const secret = apiKey.slice(separator + 1);
  if (!SERVICE_ID_PATTERN.test(serviceId) || !SECRET_PATTERN.test(secret)) {
    throw new IntegrationCredentialServiceError('Invalid Integration credential.', 401, 'invalid_integration_credential');
  }
  return { serviceId, apiKey };
}

export function looksLikeIntegrationCredential(value: string): boolean {
  return value.trim().startsWith(`${INTEGRATION_KEY_PREFIX}_`);
}

export function createIntegrationApiKey(serviceIdValue: string): { apiKey: string; secretHash: string } {
  const serviceId = serviceIdValue.trim().toLowerCase();
  if (!SERVICE_ID_PATTERN.test(serviceId)) {
    throw new IntegrationCredentialServiceError('Integration service id is invalid.', 400, 'invalid_integration_service_id');
  }
  const apiKey = `${INTEGRATION_KEY_PREFIX}_${serviceId}_${randomBytes(32).toString('base64url')}`;
  return { apiKey, secretHash: sha256(apiKey) };
}

export function authenticateIntegrationCredential(
  value: string,
  configured = configuredIntegrationCredentials(),
): ConfiguredIntegrationCredential {
  const { serviceId, apiKey } = credentialParts(value);
  const credential = configured.find((item) => item.serviceId === serviceId);
  if (!credential) throw new IntegrationCredentialServiceError('Invalid Integration credential.', 401, 'invalid_integration_credential');
  const expected = Buffer.from(credential.secretHash, 'hex');
  const actual = Buffer.from(sha256(apiKey), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new IntegrationCredentialServiceError('Invalid Integration credential.', 401, 'invalid_integration_credential');
  }
  return credential;
}

export function integrationCallerForCredential(
  credential: ConfiguredIntegrationCredential,
): ServiceCallerProvenance {
  return { type: 'service', id: credential.serviceId, label: credential.label };
}
