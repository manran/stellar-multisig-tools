import type { StellarNetwork } from '../../../../packages/stellar-core/src/types.js';

export interface HumanNotificationEmail {
  subject: string;
  text: string;
  html: string;
  actionUrl: string;
}

function requestDisplayId(requestId: string): string {
  return requestId.length === 16
    ? requestId.match(/.{1,4}/g)?.join('-') ?? requestId
    : requestId;
}

function requestActionUrl(webOrigin: string, requestId: string): string {
  const url = new URL('/s', webOrigin);
  url.hash = requestId;
  return url.toString();
}

export function buildSignatureRequestedEmail(input: {
  requestId: string;
  network: StellarNetwork;
  expiresAt: string;
  webOrigin: string;
}): HumanNotificationEmail {
  const actionUrl = requestActionUrl(input.webOrigin, input.requestId);
  const networkLabel = input.network === 'testnet' ? 'Stellar Testnet' : 'Stellar Mainnet';
  const subject = input.network === 'testnet'
    ? '[Testnet] Signature requested in MultiSig Tools'
    : 'Signature requested in MultiSig Tools';
  const displayId = requestDisplayId(input.requestId);
  const closesAt = new Date(input.expiresAt).toISOString();

  const text = [
    `A signer asked you to review and sign a MultiSig Tools proposal on ${networkLabel}.`,
    '',
    `Request: ${displayId}`,
    `Signing closes: ${closesAt}`,
    '',
    `Open proposal: ${actionUrl}`,
    '',
    'This email does not grant signing authority. MultiSig Tools will require you to confirm the assigned signer wallet before showing the proposal.',
  ].join('\n');

  const html = [
    '<p>A signer asked you to review and sign a MultiSig Tools proposal.</p>',
    `<p><strong>Network:</strong> ${networkLabel}<br><strong>Request:</strong> ${displayId}<br><strong>Signing closes:</strong> ${closesAt}</p>`,
    `<p><a href="${actionUrl}">Review proposal</a></p>`,
    '<p>This email does not grant signing authority. MultiSig Tools will require you to confirm the assigned signer wallet before showing the proposal.</p>',
  ].join('');

  return { subject, text, html, actionUrl };
}
