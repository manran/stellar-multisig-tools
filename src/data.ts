export type NetworkId =
  | 'bitcoin'
  | 'evm'
  | 'solana'
  | 'aptos'
  | 'sui'
  | 'cosmos'
  | 'polkadot'
  | 'cardano';

export type ProductType =
  | 'Multisig Wallet'
  | 'Treasury & Ops'
  | 'Custody & MPC'
  | 'Infrastructure';

export type ListingType =
  | 'Core Multisig'
  | 'Tooling'
  | 'Multisig Tooling'
  | 'MPC'
  | 'MPC / Threshold Alternative'
  | 'Custody'
  | 'Custody Platform'
  | 'Infrastructure';

export type SecurityModel =
  | 'Script'
  | 'Script Multisig'
  | 'Smart Contract'
  | 'Smart Contract Multisig'
  | 'MPC/TSS'
  | 'Native'
  | 'Native Multisig'
  | 'Hybrid';

export type CustodyModel =
  | 'Self-Custody'
  | 'Collaborative Custody'
  | 'Custodial'
  | 'Hybrid';

export type OpenSourceStatus =
  | 'Fully Open Source'
  | 'Partially Open Source'
  | 'Closed Source'
  | 'Unknown';

export interface MultiSigService {
  id: string;
  name: string;
  description: string;
  url: string;

  ecosystems: NetworkId[];
  supportedChains?: string[];

  productType: ProductType;
  listingType: ListingType;
  securityModel: SecurityModel;
  custodyModel: CustodyModel;

  targetUsers?: ('Individual' | 'Team/DAO' | 'Enterprise' | 'Developer')[];
  useCases?: string[];

  hasAudit: boolean;
  auditNotes?: string;
  audits?: {
    auditor: string;
    date?: string;
    url?: string;
    scope?: string;
  }[];

  openSourceStatus: OpenSourceStatus;
  openSourceNotes?: string;
  repoUrl?: string;

  features?: string[];
  
  // TODO: Future enhancement - add real logos for each service.
  logo?: string;

  featured?: boolean;
  status?: 'Active' | 'Beta' | 'Deprecated' | 'Unknown';
  lastVerified?: string;
}

export const NETWORKS: { id: NetworkId | 'all'; name: string; icon: string }[] = [
  { id: 'all', name: 'All Networks', icon: '🌐' },
  { id: 'bitcoin', name: 'Bitcoin', icon: '₿' },
  { id: 'evm', name: 'EVM Chains', icon: 'Ξ' },
  { id: 'solana', name: 'Solana', icon: '◎' },
  { id: 'aptos', name: 'Aptos', icon: '💧' },
  { id: 'sui', name: 'Sui', icon: '💧' },
  { id: 'cosmos', name: 'Cosmos', icon: '⚛' },
  { id: 'polkadot', name: 'Polkadot', icon: '🟣' },
  { id: 'cardano', name: 'Cardano', icon: '₳' },
];

export const CATEGORIES: ('All Types' | ProductType)[] = [
  'All Types',
  'Multisig Wallet',
  'Treasury & Ops',
  'Custody & MPC',
  'Infrastructure',
];

export const SERVICES: MultiSigService[] = [
  {
    id: 'safe',
    name: 'Safe',
    description: 'Smart contract wallet and multisig infrastructure widely used across EVM-compatible networks.',
    url: 'https://safe.global/',
    ecosystems: ['evm'],
    supportedChains: ['Ethereum', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Smart Contract Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Individual', 'Team/DAO', 'Developer'],
    useCases: ['DAO treasury', 'protocol ops', 'team multisig', 'personal vault'],
    hasAudit: true,
    auditNotes: 'Extensively audited by multiple top-tier firms over years.',
    openSourceStatus: 'Fully Open Source',
    repoUrl: 'https://github.com/safe-global',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'squads',
    name: 'Squads',
    description: 'Smart contract-based multisig and treasury management protocol for the Solana ecosystem.',
    url: 'https://squads.so/',
    ecosystems: ['solana'],
    productType: 'Treasury & Ops',
    listingType: 'Core Multisig',
    securityModel: 'Smart Contract Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Team/DAO', 'Enterprise'],
    useCases: ['treasury management', 'program upgrade authority', 'token vesting'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'casa',
    name: 'Casa',
    description: 'Multi-key vaults providing collaborative custody and self-custody solutions for Bitcoin and Ethereum.',
    url: 'https://casa.io/',
    ecosystems: ['bitcoin', 'evm'],
    supportedChains: ['Bitcoin', 'Ethereum'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Hybrid',
    custodyModel: 'Collaborative Custody',
    targetUsers: ['Individual', 'Enterprise'],
    useCases: ['personal wealth protection', 'inheritance planning'],
    hasAudit: true,
    openSourceStatus: 'Partially Open Source',
    openSourceNotes: 'Mobile apps are open source, backend routing/services are proprietary.',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'den',
    name: 'Den',
    description: 'Multisig interface and workflow automation platform built on top of Safe smart contracts.',
    url: 'https://onchainden.com/',
    ecosystems: ['evm'],
    productType: 'Treasury & Ops',
    listingType: 'Multisig Tooling',
    securityModel: 'Smart Contract Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Team/DAO'],
    useCases: ['team operations', 'transaction batching', 'accounting'],
    hasAudit: true,
    openSourceStatus: 'Closed Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'coinshift',
    name: 'Coinshift',
    description: 'Treasury management platform and corporate card issuer built on Safe infrastructure.',
    url: 'https://coinshift.xyz/',
    ecosystems: ['evm'],
    productType: 'Treasury & Ops',
    listingType: 'Multisig Tooling',
    securityModel: 'Smart Contract Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Team/DAO', 'Enterprise'],
    useCases: ['payroll', 'expense management', 'treasury reporting'],
    hasAudit: true,
    openSourceStatus: 'Closed Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'msafe',
    name: 'MSafe',
    description: 'Smart contract multisig wallet designed for Move-based blockchains.',
    url: 'https://m-safe.io/',
    ecosystems: ['aptos', 'sui'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Smart Contract Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Team/DAO', 'Developer'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'nunchuk',
    name: 'Nunchuk',
    description: 'Bitcoin multisig wallet focused on collaborative custody, hardware wallet integration, and inheritance.',
    url: 'https://nunchuk.io/',
    ecosystems: ['bitcoin'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Script Multisig',
    custodyModel: 'Collaborative Custody',
    targetUsers: ['Individual', 'Team/DAO'],
    useCases: ['bitcoin self-custody', 'family vaults', 'hardware wallet multisig'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'sparrow',
    name: 'Sparrow Wallet',
    description: 'Desktop Bitcoin wallet with advanced features for privacy, coin control, and script-based multisig setups.',
    url: 'https://sparrowwallet.com/',
    ecosystems: ['bitcoin'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Script Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Individual', 'Developer'],
    useCases: ['advanced bitcoin storage', 'privacy-focused transactions'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'bitgo',
    name: 'BitGo',
    description: 'Institutional digital asset platform offering regulated custody, TSS, and multisig wallets.',
    url: 'https://www.bitgo.com/',
    ecosystems: ['bitcoin', 'evm', 'solana', 'aptos', 'sui', 'polkadot'],
    productType: 'Custody & MPC',
    listingType: 'Custody Platform',
    securityModel: 'Hybrid',
    custodyModel: 'Custodial',
    targetUsers: ['Enterprise'],
    useCases: ['institutional custody', 'exchange wallets', 'prime brokerage'],
    hasAudit: true,
    openSourceStatus: 'Closed Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'fireblocks',
    name: 'Fireblocks',
    description: 'Enterprise-grade digital asset operations platform utilizing MPC-CMP technology.',
    url: 'https://www.fireblocks.com/',
    ecosystems: ['bitcoin', 'evm', 'solana', 'cosmos', 'polkadot'],
    productType: 'Custody & MPC',
    listingType: 'MPC / Threshold Alternative',
    securityModel: 'MPC/TSS',
    custodyModel: 'Hybrid',
    targetUsers: ['Enterprise'],
    useCases: ['institutions', 'trading firms', 'custody operations'],
    hasAudit: true,
    openSourceStatus: 'Closed Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    description: 'Multisig and automation platform for Solana teams to schedule and execute transactions.',
    url: 'https://snowflake.so/',
    ecosystems: ['solana'],
    productType: 'Treasury & Ops',
    listingType: 'Multisig Tooling',
    securityModel: 'Smart Contract Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Team/DAO'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'nucleo',
    name: 'Nucleo',
    description: 'Private multisig protocol on EVM networks leveraging zero-knowledge cryptography.',
    url: 'https://www.gonucleo.xyz/',
    ecosystems: ['evm'],
    productType: 'Infrastructure',
    listingType: 'Infrastructure',
    securityModel: 'Smart Contract Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Team/DAO', 'Developer'],
    useCases: ['private treasury management', 'anonymous voting'],
    hasAudit: true,
    openSourceStatus: 'Closed Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'unchained',
    name: 'Unchained',
    description: 'Financial services and collaborative custody vaults for Bitcoin holders using native multisig.',
    url: 'https://unchained.com/',
    ecosystems: ['bitcoin'],
    productType: 'Custody & MPC',
    listingType: 'Core Multisig',
    securityModel: 'Script Multisig',
    custodyModel: 'Collaborative Custody',
    targetUsers: ['Individual', 'Enterprise'],
    useCases: ['bitcoin retirement accounts', 'corporate treasury'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'multix',
    name: 'Multix',
    description: 'Interface to manage complex multisig accounts across Polkadot and Substrate networks.',
    url: 'https://multix.chainsafe.io/',
    ecosystems: ['polkadot'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Native Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Team/DAO', 'Individual'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'apollo-safe',
    name: 'Apollo Safe',
    description: 'CW3 smart contract multisig frontend for the Cosmos ecosystem and CosmWasm chains.',
    url: 'https://safe.apollo.farm/',
    ecosystems: ['cosmos'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Smart Contract Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Team/DAO'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'roundtable',
    name: 'RoundTable',
    description: 'Native multisignature wallet interface for the Cardano blockchain.',
    url: 'https://roundtable.io/',
    ecosystems: ['cardano'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Native Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Team/DAO', 'Individual'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'copper',
    name: 'Copper',
    description: 'Institutional digital asset custody utilizing Multi-Party Computation (MPC) technology.',
    url: 'https://copper.co/',
    ecosystems: ['bitcoin', 'evm', 'solana', 'polkadot'],
    productType: 'Custody & MPC',
    listingType: 'MPC / Threshold Alternative',
    securityModel: 'MPC/TSS',
    custodyModel: 'Custodial',
    targetUsers: ['Enterprise'],
    useCases: ['prime brokerage', 'institutional trading'],
    hasAudit: true,
    openSourceStatus: 'Closed Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'liana',
    name: 'Liana',
    description: 'Bitcoin wallet featuring timelocked recovery paths for advanced multisig inheritance planning.',
    url: 'https://wizardsardine.com/liana/',
    ecosystems: ['bitcoin'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Script Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Individual'],
    useCases: ['inheritance planning', 'decaying multisig'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    features: ['Timelock recovery'],
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'specter',
    name: 'Specter Desktop',
    description: 'Desktop GUI for Bitcoin Core optimized to work with hardware wallets and air-gapped multisig setups.',
    url: 'https://specter.solutions/',
    ecosystems: ['bitcoin'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Script Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Individual', 'Developer'],
    useCases: ['air-gapped signing', 'node operators', 'hardware wallet multisig'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    repoUrl: 'https://github.com/cryptoadvance/specter-desktop',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'blockstream-green',
    name: 'Blockstream Green',
    description: 'Bitcoin wallet offering 2-of-2 and 2-of-3 multisig accounts with timelock recovery and hardware support.',
    url: 'https://blockstream.com/green/',
    ecosystems: ['bitcoin'],
    productType: 'Multisig Wallet',
    listingType: 'Core Multisig',
    securityModel: 'Script Multisig',
    custodyModel: 'Collaborative Custody',
    targetUsers: ['Individual'],
    useCases: ['mobile multisig', '2FA security'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'zengo',
    name: 'Zengo',
    description: 'Consumer-focused crypto wallet utilizing MPC cryptography instead of traditional seed phrases for key recovery.',
    url: 'https://zengo.com/',
    ecosystems: ['bitcoin', 'evm'],
    productType: 'Multisig Wallet',
    listingType: 'MPC / Threshold Alternative',
    securityModel: 'MPC/TSS',
    custodyModel: 'Self-Custody',
    targetUsers: ['Individual'],
    useCases: ['seedless wallet', 'consumer onboarding'],
    hasAudit: true,
    openSourceStatus: 'Partially Open Source',
    openSourceNotes: 'Client cryptography is open source, server infrastructure is closed.',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'fordefi',
    name: 'Fordefi',
    description: 'Institutional MPC wallet and security platform purpose-built for decentralized finance (DeFi) interactions.',
    url: 'https://fordefi.com/',
    ecosystems: ['evm', 'solana'],
    productType: 'Custody & MPC',
    listingType: 'MPC / Threshold Alternative',
    securityModel: 'MPC/TSS',
    custodyModel: 'Self-Custody',
    targetUsers: ['Enterprise', 'Team/DAO'],
    useCases: ['institutional DeFi', 'policy engine', 'trading'],
    hasAudit: true,
    openSourceStatus: 'Closed Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'cobo',
    name: 'Cobo',
    description: 'Digital asset custody solutions spanning full custody, MPC co-managed custody, and smart contract-based custody.',
    url: 'https://www.cobo.com/',
    ecosystems: ['bitcoin', 'evm', 'solana', 'aptos', 'sui', 'cosmos', 'polkadot'],
    productType: 'Custody & MPC',
    listingType: 'Custody Platform',
    securityModel: 'Hybrid',
    custodyModel: 'Hybrid',
    targetUsers: ['Enterprise'],
    useCases: ['exchange wallets', 'asset management', 'staking'],
    hasAudit: true,
    openSourceStatus: 'Closed Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'argent',
    name: 'Argent',
    description: 'Smart contract wallet pioneering account abstraction, social recovery, and multisig security without seed phrases.',
    url: 'https://www.argent.xyz/',
    ecosystems: ['evm'],
    supportedChains: ['Ethereum', 'Starknet', 'zkSync'],
    productType: 'Multisig Wallet',
    listingType: 'Multisig Tooling',
    securityModel: 'Smart Contract Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Individual'],
    useCases: ['social recovery', 'L2 DeFi', 'seedless wallet'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    openSourceNotes: 'Smart contracts are open source and verified.',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'biconomy',
    name: 'Biconomy',
    description: 'Account abstraction infrastructure and modular smart contract accounts for developers to build custom multisig flows.',
    url: 'https://www.biconomy.io/',
    ecosystems: ['evm'],
    productType: 'Infrastructure',
    listingType: 'Infrastructure',
    securityModel: 'Smart Contract Multisig',
    custodyModel: 'Self-Custody',
    targetUsers: ['Developer', 'Team/DAO'],
    useCases: ['gasless transactions', 'custom AA wallets', 'SDK integration'],
    hasAudit: true,
    openSourceStatus: 'Fully Open Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'anchorage',
    name: 'Anchorage Digital',
    description: 'Regulated crypto platform providing institutional custody, trading, and financing services.',
    url: 'https://www.anchorage.com/',
    ecosystems: ['bitcoin', 'evm', 'solana', 'aptos', 'sui', 'cosmos', 'polkadot', 'cardano'],
    productType: 'Custody & MPC',
    listingType: 'Custody Platform',
    securityModel: 'Hybrid',
    custodyModel: 'Custodial',
    targetUsers: ['Enterprise'],
    useCases: ['regulated custody', 'institutional staking', 'prime brokerage'],
    hasAudit: true,
    openSourceStatus: 'Closed Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  },
  {
    id: 'utila',
    name: 'Utila',
    description: 'Enterprise-grade MPC wallet platform for organizations to manage digital assets across multiple chains.',
    url: 'https://utila.io/',
    ecosystems: ['bitcoin', 'evm', 'solana'],
    productType: 'Custody & MPC',
    listingType: 'MPC / Threshold Alternative',
    securityModel: 'MPC/TSS',
    custodyModel: 'Self-Custody',
    targetUsers: ['Enterprise', 'Team/DAO'],
    useCases: ['corporate treasury', 'team operations', 'multi-chain management'],
    hasAudit: true,
    openSourceStatus: 'Closed Source',
    status: 'Active',
    lastVerified: '2026-03-22',
  }
];
