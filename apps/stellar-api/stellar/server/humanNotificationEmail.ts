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

export function buildSignatureRequestedEmail(input: {
  requestId: string;
  network: StellarNetwork;
  expiresAt: string;
  webOrigin: string;
  actorAddress: string;
}): HumanNotificationEmail {
  const actionUrl = requestActionUrl(input.webOrigin, input.requestId);
  const networkLabel = input.network === 'testnet' ? 'Stellar Testnet' : 'Stellar Mainnet';
  const subject = input.network === 'testnet'
    ? '[Testnet] Signature requested in MultiSig Tools'
    : 'Signature requested in MultiSig Tools';
  const displayId = requestDisplayId(input.requestId);
  const closesAt = signingDeadline(input.expiresAt);
  const inboxUrl = new URL('/inbox', input.webOrigin).toString();

  const text = [
    'You\'ve been asked to review and sign a proposal in MultiSig Tools.',
    '',
    `Requested by: ${input.actorAddress}`,
    `Network: ${networkLabel}`,
    `Proposal ID: ${displayId}`,
    `Signing closes: ${closesAt}`,
    '',
    `Review proposal: ${actionUrl}`,
    '',
    'Prefer not to follow links in email? Open MultiSig Tools directly, confirm the assigned signer wallet, and check Inbox.',
    `Inbox: ${inboxUrl}`,
    `If needed, you can also open a shared transaction and enter Proposal ID ${displayId}.`,
    '',
    'Your Stellar wallet—not this email—determines signing access. This email does not grant signing authority.',
  ].join('\n');

  const html = [
    '<p>You\'ve been asked to review and sign a proposal in MultiSig Tools.</p>',
    `<p><strong>Requested by:</strong><br><span style="word-break:break-all">${input.actorAddress}</span></p>`,
    `<p><strong>Network:</strong> ${networkLabel}<br><strong>Proposal ID:</strong> ${displayId}<br><strong>Signing closes:</strong> ${closesAt}</p>`,
    `<p><a href="${actionUrl}"><strong>Review proposal</strong></a></p>`,
    `<p>Prefer not to follow links in email? Open <a href="${inboxUrl}">MultiSig Tools</a> directly, confirm the assigned signer wallet, and check <strong>Inbox</strong>. If needed, you can also open a shared transaction and enter Proposal ID <strong>${displayId}</strong>.</p>`,
    '<p>Your Stellar wallet—not this email—determines signing access. This email does not grant signing authority.</p>',
  ].join('');

  return { subject, text, html, actionUrl };
}
