import { normalizedStellarWorkspacePath } from '../workspaceRoutes.js';

export type DocsSectionId = 'start' | 'transactions' | 'concepts' | 'developers';

export interface DocsPageDefinition {
  path: string;
  title: string;
  summary: string;
  section: DocsSectionId;
}

export interface DocsSectionDefinition {
  id: DocsSectionId;
  label: string;
  pages: readonly DocsPageDefinition[];
}

export const DOCS_HOME_PATH = '/docs';
export const DOCS_DEVELOPERS_PATH = '/docs/developers';
export const DOCS_DEVELOPER_QUICKSTART_PATH = '/docs/developers/testnet-quickstart';
export const DOCS_DEVELOPER_CLASSIC_PATH = '/docs/developers/classic';
export const DOCS_DEVELOPER_SOROBAN_PATH = '/docs/developers/soroban';
export const DOCS_DEVELOPER_API_PATH = '/docs/developers/api';
export const DOCS_DEVELOPER_SECURITY_PATH = '/docs/developers/security';
export const DOCS_AUTOMATION_PATH = '/docs/automation';
export const LEGACY_DEVELOPERS_PATH = '/developers';

export const DOCS_SECTIONS: readonly DocsSectionDefinition[] = [
  {
    id: 'start',
    label: 'Start',
    pages: [
      {
        path: '/docs/sign-a-proposal',
        title: 'Sign a Proposal',
        summary: 'Open a shared Proposal, review the exact transaction, and add your signature.',
        section: 'start',
      },
      {
        path: '/docs/create-a-treasury',
        title: 'Create a Treasury',
        summary: 'Turn a Stellar account into shared authorization with clear payment and account-control rules.',
        section: 'start',
      },
    ],
  },
  {
    id: 'transactions',
    label: 'Transactions',
    pages: [
      {
        path: '/docs/transactions/payment',
        title: 'Send a payment',
        summary: 'Prepare a normal Stellar payment and hand the reviewed transaction to the Proposal flow.',
        section: 'transactions',
      },
      {
        path: '/docs/transactions/batch-payment',
        title: 'Send to multiple recipients',
        summary: 'Validate every recipient and prepare one atomic multi-payment transaction.',
        section: 'transactions',
      },
      {
        path: '/docs/transactions/claimable-payment',
        title: 'Send a claimable payment',
        summary: 'Let a recipient claim later while keeping a built-in recovery path for the sending Treasury.',
        section: 'transactions',
      },
      {
        path: '/docs/transactions/multi-party',
        title: 'Multi-party transaction',
        summary: 'Prepare one atomic transaction whose payment operations are authorized by multiple source accounts.',
        section: 'transactions',
      },
    ],
  },
  {
    id: 'concepts',
    label: 'Concepts',
    pages: [
      {
        path: '/docs/concepts/proposal-and-transaction',
        title: 'Proposal and Transaction',
        summary: 'Understand the shared Human view around one exact Stellar transaction.',
        section: 'concepts',
      },
      {
        path: '/docs/concepts/multi-party-transactions',
        title: 'Multi-party transactions',
        summary: 'See how one transaction can require independent authorization from more than one account.',
        section: 'concepts',
      },
      {
        path: '/docs/concepts/sign-and-unlock',
        title: 'Sign and Unlock',
        summary: 'Why signing a transaction and opening private workspace data prove different scopes.',
        section: 'concepts',
      },
      {
        path: '/docs/concepts/history-and-privacy',
        title: 'Activity, History and privacy',
        summary: 'Know what is on-chain, what MultiSig Tools retains, and which views are private.',
        section: 'concepts',
      },
    ],
  },
  {
    id: 'developers',
    label: 'Developers',
    pages: [
      {
        path: DOCS_DEVELOPERS_PATH,
        title: 'Choose your integration',
        summary: 'Choose Hosted, On my site, or Full Headless based on how much signer interaction and orchestration your product owns.',
        section: 'developers',
      },
      {
        path: DOCS_DEVELOPER_QUICKSTART_PATH,
        title: 'Testnet quickstart',
        summary: 'Run one Hosted Classic Request end to end on Testnet, then branch into Soroban or deeper API integration as needed.',
        section: 'developers',
      },
      {
        path: DOCS_DEVELOPER_CLASSIC_PATH,
        title: 'Classic integration',
        summary: 'Create semantic Classic payment Requests while keeping Treasury signer authority on Stellar.',
        section: 'developers',
      },
      {
        path: DOCS_DEVELOPER_SOROBAN_PATH,
        title: 'Soroban integration',
        summary: 'Create semantic contract Intents, collect AUTH, and keep execution bound to the configured policy.',
        section: 'developers',
      },
      {
        path: DOCS_DEVELOPER_API_PATH,
        title: 'API and webhooks',
        summary: 'Use the OpenAPI contract, idempotency, Job projection, and signed webhook delivery correctly.',
        section: 'developers',
      },
      {
        path: DOCS_DEVELOPER_SECURITY_PATH,
        title: 'Security model',
        summary: 'Understand the separation between Service identity, signer authority, disclosure capability, and execution ownership.',
        section: 'developers',
      },
      {
        path: DOCS_AUTOMATION_PATH,
        title: 'Agent API',
        summary: 'Delegate Read, Write, or Sign API access from one Stellar signer to a distinct Agent actor.',
        section: 'developers',
      },
    ],
  },
];

export const DOCS_PAGES: readonly DocsPageDefinition[] = DOCS_SECTIONS.flatMap((section) => section.pages);

export function normalizedDocsPath(pathname: string) {
  const path = normalizedStellarWorkspacePath(pathname);
  return path === LEGACY_DEVELOPERS_PATH ? DOCS_DEVELOPERS_PATH : path;
}

export function docsPageForPath(pathname: string) {
  const path = normalizedDocsPath(pathname);
  if (path === DOCS_HOME_PATH) return null;
  return DOCS_PAGES.find((page) => page.path === path) ?? undefined;
}

export function isDocsPath(pathname: string) {
  const path = normalizedStellarWorkspacePath(pathname);
  return path === DOCS_HOME_PATH || path.startsWith(`${DOCS_HOME_PATH}/`) || path === LEGACY_DEVELOPERS_PATH;
}
