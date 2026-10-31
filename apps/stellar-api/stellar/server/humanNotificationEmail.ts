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

function signingDeadline(value: string): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value));
  return `${formatted} UTC`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildSignatureRequestedEmail(input: {
  requestId: string;
  network: StellarNetwork;
  expiresAt: string;
  webOrigin: string;
  actorAddress: string;
  systemType: string;
  businessLabel?: string;
}): HumanNotificationEmail {
  const actionUrl = requestActionUrl(input.webOrigin, input.requestId);
  const networkLabel = input.network === 'testnet' ? 'Stellar Testnet' : 'Stellar Mainnet';
  const subject = input.network === 'testnet'
    ? '[Testnet] Signature requested in MultiSig Tools'
    : 'Signature requested in MultiSig Tools';
  const displayId = requestDisplayId(input.requestId);
  const closesAt = signingDeadline(input.expiresAt);
  const inboxUrl = new URL('/inbox', input.webOrigin).toString();

  const businessLabel = input.businessLabel?.trim();
  const workLabel = businessLabel || input.systemType;
  const actorHtml = escapeHtml(input.actorAddress);
  const workLabelHtml = escapeHtml(workLabel);
  const systemTypeHtml = escapeHtml(input.systemType);

  const text = [
    `Signing closes: ${closesAt}`,
    '',
    `${input.actorAddress} invited you to review and sign:`,
    businessLabel ? businessLabel : input.systemType,
    ...(businessLabel ? [input.systemType] : []),
    '',
    `Network: ${networkLabel}`,
    `Proposal ID: ${displayId}`,
    '',
    `Review proposal: ${actionUrl}`,
    '',
    'Or open MultiSig Tools directly, confirm the assigned signer wallet, and continue from Inbox.',
    `Inbox: ${inboxUrl}`,
    `If needed, you can also enter Proposal ID ${displayId}.`,
    '',
    'Your Stellar wallet—not this email—determines signing access. This email does not grant signing authority.',
  ].join('\n');

  const html = [
    `<p><strong>Signing closes:</strong> ${closesAt}</p>`,
    `<p><span style="word-break:break-all">${actorHtml}</span> invited you to review and sign:</p>`,
    `<p><strong>${workLabelHtml}</strong>${businessLabel ? `<br>${systemTypeHtml}` : ''}</p>`,
    `<p><strong>Network:</strong> ${networkLabel}<br><strong>Proposal ID:</strong> ${displayId}</p>`,
    `<p><a href="${actionUrl}"><strong>Review proposal</strong></a></p>`,
    `<p>Or open <a href="${inboxUrl}">MultiSig Tools</a> directly, confirm the assigned signer wallet, and continue from <strong>Inbox</strong>. If needed, enter Proposal ID <strong>${displayId}</strong>.</p>`,
    '<p>Your Stellar wallet—not this email—determines signing access. This email does not grant signing authority.</p>',
  ].join('');

  return { subject, text, html, actionUrl };
}
