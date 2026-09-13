import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  Moon, 
  Sun, 
  ExternalLink, 
  ShieldCheck, 
  Code, 
  Filter,
  LayoutGrid,
  List,
  Info
} from 'lucide-react';
import { SERVICES, NETWORKS, CATEGORIES, MultiSigService, NetworkId } from './data';

function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const isDown = useRef(false);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!ref.current) return;
    isDown.current = true;
    isDragging.current = false;
    startX.current = e.pageX - ref.current.offsetLeft;
    scrollLeft.current = ref.current.scrollLeft;
    ref.current.style.cursor = 'grabbing';
  };

  const onMouseLeave = () => {
    isDown.current = false;
    if (ref.current) ref.current.style.cursor = 'grab';
  };

  const onMouseUp = () => {
    isDown.current = false;
    if (ref.current) ref.current.style.cursor = 'grab';
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDown.current || !ref.current) return;
    e.preventDefault();
    const x = e.pageX - ref.current.offsetLeft;
    const walk = (x - startX.current) * 2;
    if (Math.abs(walk) > 5) {
      isDragging.current = true;
    }
    ref.current.scrollLeft = scrollLeft.current - walk;
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (isDragging.current) {
      e.stopPropagation();
      e.preventDefault();
      isDragging.current = false;
    }
  };

  return { ref, onMouseDown, onMouseLeave, onMouseUp, onMouseMove, onClickCapture, style: { cursor: 'grab' } };
}

export default function App() {
  const networkScroll = useDragScroll();
  const categoryScroll = useDragScroll();

  const [selectedNetwork, setSelectedNetwork] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('All Types');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // 1. Check if user has manually set a preference in the past
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        return savedTheme === 'dark';
      }
      // 2. If no manual preference, check the system default
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true; // Default fallback
  });

  // Handle dark mode class and local storage
  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Listen for system theme changes (only applies if user hasn't manually overridden, or if we want to keep them in sync)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Only auto-switch if the user hasn't explicitly set a preference
      if (!localStorage.getItem('theme')) {
        setIsDarkMode(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode((prev) => !prev);
  };

  const filteredServices = useMemo(() => {
    return SERVICES.filter((service) => {
      const matchesNetwork = selectedNetwork === 'all' || service.ecosystems.includes(selectedNetwork as NetworkId);
      const matchesCategory = selectedCategory === 'All Types' || service.productType === selectedCategory;
      const matchesSearch = service.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            service.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesNetwork && matchesCategory && matchesSearch;
    });
  }, [selectedNetwork, selectedCategory, searchQuery]);

  const currentNetworkInfo = useMemo(() => {
    return NETWORKS.find(n => n.id === selectedNetwork);
  }, [selectedNetwork]);

  return (
    <div className="min-h-screen bg-[#F5F5F0] dark:bg-[#0A0A0A] text-[#1A1A1A] dark:text-[#F5F5F0] transition-colors duration-300 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-black/80 backdrop-blur-md border-bottom border-black/5 dark:border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 md:h-16">
            <div className="flex items-center gap-2">
              <div className="relative flex items-center justify-center w-8 h-8 md:w-9 md:h-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/20 text-white border border-white/10">
                {/* Custom MultiSig Logo: A shield with 3 dots representing multiple signers */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <circle cx="12" cy="11" r="1.5" fill="currentColor" />
                  <circle cx="7.5" cy="11" r="1.5" fill="currentColor" />
                  <circle cx="16.5" cy="11" r="1.5" fill="currentColor" />
                </svg>
              </div>
              <h1 className="text-lg md:text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-600 to-teal-600 dark:from-emerald-400 dark:to-teal-300">
                MultiSig Tools
              </h1>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative hidden md:block">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search wallets and tools..."
                  className="pl-10 pr-4 py-1.5 bg-black/5 dark:bg-white/5 border border-transparent focus:border-emerald-500 rounded-full text-sm outline-none transition-all w-64"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <button
                onClick={toggleDarkMode}
                className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                aria-label="Toggle theme"
              >
                {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        <div className="mb-6 md:mb-10">
          <p className="hidden md:block text-sm opacity-70 max-w-2xl leading-relaxed mb-6">
            Discover multisig wallets, treasury tools, custody platforms, and related signing infrastructure across crypto ecosystems.
          </p>
          <p className="md:hidden text-sm opacity-70 leading-snug mb-4">
            Discover multisig wallets, treasury tools, and custody infrastructure across crypto ecosystems.
          </p>
          <div className="md:hidden relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <input
              type="text"
              placeholder="Search wallets and tools..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
            />
          </div>
        </div>

        {/* Network Navigation */}
        <div className="mb-6 lg:mb-12 relative">
          <div 
            {...networkScroll}
            className="flex overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:pb-0 sm:flex-wrap items-center gap-2 md:gap-3 mb-6 hide-scrollbar"
          >
            {NETWORKS.map((network) => (
              <button
                key={network.id}
                onClick={() => setSelectedNetwork(network.id)}
                className={`flex items-center gap-1.5 md:gap-2 px-3 py-1.5 md:px-4 md:py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap shrink-0 ${
                  selectedNetwork === network.id
                    ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                    : 'bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 hover:border-emerald-500/50'
                }`}
              >
                <span>{network.icon}</span>
                {network.name}
              </button>
            ))}
          </div>

          {/* Network Info Banner */}
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedNetwork}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="hidden lg:flex bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 mb-8 items-start gap-4"
            >
              <Info className="w-6 h-6 text-emerald-500 shrink-0 mt-1" />
              <div>
                <h2 className="text-lg font-semibold mb-1">
                  {selectedNetwork === 'all' ? 'Explore the Multisig Ecosystem' : `${currentNetworkInfo?.name} Multisig`}
                </h2>
                <p className="text-sm opacity-70 leading-relaxed">
                  {selectedNetwork === 'bitcoin' && "Bitcoin multisig usually relies on script-based (P2SH) or Taproot (MuSig2) implementations for secure asset management."}
                  {selectedNetwork === 'ethereum' && "Ethereum multisig is primarily implemented via smart contract wallets like Safe, offering programmable security and recovery."}
                  {selectedNetwork === 'solana' && "Solana multisig tools leverage the network's high speed and low cost, often used for program management and treasury governance."}
                  {selectedNetwork === 'cosmos' && "Cosmos multisig is built into the SDK, allowing interchain accounts and native governance integration across the ecosystem."}
                  {selectedNetwork === 'l2' && "Layer 2 solutions inherit Ethereum's security while providing faster and cheaper multisig operations for active teams."}
                  {selectedNetwork === 'all' && "Browse a curated directory of multisig wallets, treasury platforms, custody solutions, and related infrastructure used across the blockchain ecosystem."}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Filters and Grid */}
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar Filters */}
          <aside className="w-full lg:w-64 shrink-0 lg:space-y-8 mb-2 lg:mb-0">
            <div className="relative">
              <h3 className="hidden lg:flex text-xs font-bold uppercase tracking-wider opacity-50 mb-4 items-center gap-2">
                <Filter className="w-3 h-3" /> Browse by Type
              </h3>
              <div 
                {...categoryScroll}
                className="flex overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:pb-0 lg:flex-col gap-2 hide-scrollbar"
              >
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`whitespace-nowrap shrink-0 lg:w-full text-left px-3 py-1.5 md:px-4 md:py-2 rounded-lg md:rounded-xl text-sm transition-all ${
                      selectedCategory === cat
                        ? 'bg-emerald-500/10 text-emerald-500 font-semibold'
                        : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="hidden lg:block p-4 bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl">
              <h4 className="text-sm font-semibold mb-2">Why Multisig?</h4>
              <p className="text-xs opacity-60 leading-relaxed">
                Multisig and threshold-based tools improve asset security by spreading control across multiple keys, people, or approval rules instead of relying on a single signer.
              </p>
            </div>
          </aside>

          {/* Grid */}
          <div className="flex-1">
            <div className="flex items-end justify-between gap-4 mb-4 md:mb-6">
              <div>
                <h3 className="text-lg md:text-xl font-bold mb-0.5">
                  {filteredServices.length} results
                </h3>
                <div className="text-xs md:text-sm font-medium opacity-60">
                  {selectedNetwork === 'all' ? 'All Networks' : NETWORKS.find(n => n.id === selectedNetwork)?.name} · {selectedCategory}
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-1 bg-black/5 dark:bg-white/5 p-1 rounded-lg shrink-0">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-md transition-all ${
                    viewMode === 'grid' 
                      ? 'bg-white dark:bg-black shadow-sm text-emerald-500' 
                      : 'opacity-50 hover:opacity-100'
                  }`}
                  aria-label="Grid view"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-md transition-all ${
                    viewMode === 'list' 
                      ? 'bg-white dark:bg-black shadow-sm text-emerald-500' 
                      : 'opacity-50 hover:opacity-100'
                  }`}
                  aria-label="List view"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className={`grid gap-6 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
              <AnimatePresence mode="popLayout">
                {filteredServices.map((service) => (
                  <motion.div
                    key={service.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ServiceCard service={service} viewMode={viewMode} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {filteredServices.length === 0 && (
              <div className="text-center py-20">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-black/5 dark:bg-white/5 mb-4">
                  <Search className="w-8 h-8 opacity-20" />
                </div>
                <h3 className="text-lg font-medium">No services found</h3>
                <p className="text-sm opacity-50">Try adjusting your filters or search query.</p>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Explanatory Panels - Removed from here, moved to footer */}
      </main>

      <footer className="mt-16 md:mt-20 border-t border-black/5 dark:border-white/10 py-8 md:py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="md:hidden space-y-4 mb-10">
            <details className="group bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl overflow-hidden">
              <summary className="flex items-center justify-between p-4 font-semibold text-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-emerald-500" />
                  {selectedNetwork === 'all' ? 'Explore the Multisig Ecosystem' : `${currentNetworkInfo?.name} Multisig`}
                </div>
                <span className="transition group-open:rotate-180">
                  <svg fill="none" height="20" shapeRendering="geometricPrecision" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="20"><path d="M6 9l6 6 6-6"></path></svg>
                </span>
              </summary>
              <div className="px-4 pb-4 text-sm opacity-70 leading-relaxed">
                {selectedNetwork === 'bitcoin' && "Bitcoin multisig usually relies on script-based (P2SH) or Taproot (MuSig2) implementations for secure asset management."}
                {selectedNetwork === 'ethereum' && "Ethereum multisig is primarily implemented via smart contract wallets like Safe, offering programmable security and recovery."}
                {selectedNetwork === 'solana' && "Solana multisig tools leverage the network's high speed and low cost, often used for program management and treasury governance."}
                {selectedNetwork === 'cosmos' && "Cosmos multisig is built into the SDK, allowing interchain accounts and native governance integration across the ecosystem."}
                {selectedNetwork === 'l2' && "Layer 2 solutions inherit Ethereum's security while providing faster and cheaper multisig operations for active teams."}
                {selectedNetwork === 'all' && "Browse a curated directory of multisig wallets, treasury platforms, custody solutions, and related infrastructure used across the blockchain ecosystem."}
              </div>
            </details>

            <details className="group bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl overflow-hidden">
              <summary className="flex items-center justify-between p-4 font-semibold text-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  Why Multisig?
                </div>
                <span className="transition group-open:rotate-180">
                  <svg fill="none" height="20" shapeRendering="geometricPrecision" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="20"><path d="M6 9l6 6 6-6"></path></svg>
                </span>
              </summary>
              <div className="px-4 pb-4 text-sm opacity-70 leading-relaxed">
                Multisig and threshold-based tools improve asset security by spreading control across multiple keys, people, or approval rules instead of relying on a single signer.
              </div>
            </details>
          </div>

          <div className="text-center">
            <p className="text-sm opacity-40">
              &copy; 2026 MultiSig Tools. Curating the future of decentralized security.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ServiceCard({ service, viewMode = 'grid' }: { service: MultiSigService, viewMode?: 'grid' | 'list' }) {
  if (viewMode === 'list') {
    return (
      <div className="group bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl p-4 hover:border-emerald-500/50 transition-all hover:shadow-xl hover:shadow-emerald-500/5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* TODO: Replace this initial-based placeholder with actual service logos. */}
        <div className="w-12 h-12 shrink-0 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500 text-xl font-bold">
          {service.name[0]}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold uppercase tracking-wider shrink-0">
              {service.listingType}
            </span>
            <h3 className="text-lg font-bold group-hover:text-emerald-500 transition-colors truncate">
              {service.name}
            </h3>
            <div className="flex gap-1 shrink-0">
              {service.hasAudit && (
                <div className="group/tip relative">
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-gray-900 text-white text-[10px] leading-relaxed rounded opacity-0 group-hover/tip:opacity-100 transition-opacity w-max max-w-[200px] text-center z-50 pointer-events-none shadow-xl">
                    {service.auditNotes || 'Audited'}
                  </span>
                </div>
              )}
              {service.openSourceStatus === 'Fully Open Source' && (
                <div className="group/tip relative">
                  <Code className="w-4 h-4 text-blue-500" />
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-gray-900 text-white text-[10px] leading-relaxed rounded opacity-0 group-hover/tip:opacity-100 transition-opacity w-max max-w-[200px] text-center z-50 pointer-events-none shadow-xl">
                    {service.openSourceNotes || 'Open Source'}
                  </span>
                </div>
              )}
            </div>
          </div>
          <p className="text-sm opacity-60 line-clamp-2 sm:line-clamp-1">
            {service.description}
          </p>
          <div className="flex gap-2 mt-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
              {service.securityModel}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
              {service.custodyModel}
            </span>
          </div>
        </div>

        <div className="flex sm:flex-col items-center sm:items-end gap-3 shrink-0 w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-black/5 dark:border-white/10">
          <div className="flex items-center gap-2 text-[10px] font-medium opacity-50">
            <span>{service.productType}</span>
            <span className="hidden sm:inline">·</span>
            <span className="truncate max-w-[150px] hidden sm:inline">
              {service.ecosystems.map(id => NETWORKS.find(n => n.id === id)?.name).join(', ')}
            </span>
          </div>
          <div className="flex items-center gap-3 ml-auto sm:ml-0">
            <a
              href={service.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm font-semibold text-emerald-500 hover:underline"
            >
              Visit <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-2xl p-4 md:p-5 hover:border-emerald-500/50 transition-all hover:shadow-xl hover:shadow-emerald-500/5 flex flex-col h-full"
    >
      <div className="flex justify-between items-start mb-2 md:mb-3">
        {/* TODO: Replace this initial-based placeholder with actual service logos. */}
        <div className="w-10 h-10 md:w-12 md:h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500 text-lg md:text-xl font-bold">
          {service.name[0]}
        </div>
        <div className="flex gap-1 md:gap-2">
          {service.hasAudit && (
            <div className="group/tip relative p-1.5 -m-1.5 md:p-0 md:m-0 cursor-help" tabIndex={0}>
              <ShieldCheck className="w-4 h-4 md:w-5 md:h-5 text-emerald-500" />
              <span className="absolute bottom-full right-0 mb-2 px-2.5 py-1.5 bg-gray-900 text-white text-[10px] leading-relaxed rounded opacity-0 group-hover/tip:opacity-100 group-focus/tip:opacity-100 transition-opacity w-max max-w-[220px] text-left z-50 pointer-events-none shadow-xl">
                {service.auditNotes || 'Audited'}
              </span>
            </div>
          )}
          {service.openSourceStatus === 'Fully Open Source' && (
            <div className="group/tip relative p-1.5 -m-1.5 md:p-0 md:m-0 cursor-help" tabIndex={0}>
              <Code className="w-4 h-4 md:w-5 md:h-5 text-blue-500" />
              <span className="absolute bottom-full right-0 mb-2 px-2.5 py-1.5 bg-gray-900 text-white text-[10px] leading-relaxed rounded opacity-0 group-hover/tip:opacity-100 group-focus/tip:opacity-100 transition-opacity w-max max-w-[220px] text-left z-50 pointer-events-none shadow-xl">
                {service.openSourceNotes || 'Open Source'}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mb-1.5 md:mb-2">
        <span className="inline-block text-[10px] px-1.5 py-0.5 md:px-2 md:py-1 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold uppercase tracking-wider">
          {service.listingType}
        </span>
      </div>
      <h3 className="text-base md:text-lg font-bold mb-1.5 md:mb-2 group-hover:text-emerald-500 transition-colors">
        {service.name}
      </h3>
      <p className="text-sm opacity-60 mb-4 flex-1 leading-relaxed">
        {service.description}
      </p>

      <div className="flex flex-wrap gap-2 mb-4 mt-auto">
        <span className="text-[10px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
          {service.securityModel}
        </span>
        <span className="text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
          {service.custodyModel}
        </span>
      </div>

      <div className="pt-3 border-t border-black/5 dark:border-white/10 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium opacity-50">
            <span>{service.productType}</span>
            <span>·</span>
            <span className="truncate max-w-[120px]">
              {service.ecosystems.map(id => NETWORKS.find(n => n.id === id)?.name).join(', ')}
            </span>
          </div>
          <a
            href={service.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm font-semibold text-emerald-500 hover:underline shrink-0"
          >
            Visit <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
