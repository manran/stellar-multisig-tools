import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { SigningRequestStatus } from '../packages/stellar-core/src/requestTypes';
import { TRANSACTION_LIFETIME_OPTIONS } from '../packages/stellar-core/src/transactionPreferences';
import { fixedClientStellarDeploymentNetwork } from '../packages/stellar-core/src/deploymentNetwork';
import type { StellarNetwork } from '../packages/stellar-core/src/types';
import {
  HUMAN_WORKFLOW_STEPS,
  requestStatusPresentation,
} from './stellar/humanWorkflow';
import type {
  HumanStatusTone,
  HumanWorkflowStage,
} from './stellar/humanWorkflow';

export type ActionButtonVariant = 'primary' | 'secondary' | 'danger';
export type ActionButtonSize = 'sm' | 'md';

const ACTION_VARIANT_CLASS: Record<ActionButtonVariant, string> = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
  secondary: 'border border-black/10 bg-white text-neutral-800 hover:bg-black/5 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-100 dark:hover:bg-white/[0.08]',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

const ACTION_SIZE_CLASS: Record<ActionButtonSize, string> = {
  sm: 'min-h-9 px-3 py-2 text-xs',
  md: 'min-h-11 px-5 py-3 text-sm',
};

export function ActionButton({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
}) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/30 dark:focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40 ${ACTION_VARIANT_CLASS[variant]} ${ACTION_SIZE_CLASS[size]} ${className}`}
      {...props}
    />
  );
}

const BADGE_TONE_CLASS: Record<HumanStatusTone, string> = {
  neutral: 'border-black/10 bg-black/5 text-neutral-600 dark:border-white/10 dark:bg-white/10 dark:text-neutral-300',
  success: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300',
};

export function StatusBadge({ tone, children }: { tone: HumanStatusTone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${BADGE_TONE_CLASS[tone]}`}>{children}</span>;
}

export function RequestStatusBadge({ status }: { status: SigningRequestStatus }) {
  const presentation = requestStatusPresentation(status);
  return <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>;
}

function NetworkPill({ network, long = false }: { network: StellarNetwork; long?: boolean }) {
  const testnet = network === 'testnet';
  const label = testnet ? (long ? 'Stellar Testnet' : 'Testnet') : (long ? 'Stellar Mainnet' : 'Mainnet');
  const classes = testnet
    ? 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  return <span className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${classes}`}>{label}</span>;
}

export function NetworkBadge({ network, long = false }: { network: StellarNetwork; long?: boolean }) {
  if (network === 'public') return null;
  return <NetworkPill network={network} long={long} />;
}

export function NetworkFact({ network, long = false }: { network: StellarNetwork; long?: boolean }) {
  return <NetworkPill network={network} long={long} />;
}

export function TransactionLifetimePicker({
  network,
  value,
  onChange,
  disabled = false,
}: {
  network: StellarNetwork;
  value: number;
  onChange: (seconds: number) => void;
  disabled?: boolean;
}) {
  const selectedClass = network === 'testnet'
    ? 'border-sky-500 bg-sky-500/10 text-sky-800 dark:text-sky-300'
    : 'border-emerald-500 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300';

  return (
    <div>
      <div className="mb-2 text-sm font-semibold">Transaction lifetime</div>
      <div className="flex flex-wrap gap-2">
        {TRANSACTION_LIFETIME_OPTIONS.map((option) => (
          <button
            key={option.seconds}
            type="button"
            aria-pressed={value === option.seconds}
            disabled={disabled}
            onClick={() => onChange(option.seconds)}
            className={`rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${value === option.seconds ? selectedClass : 'border-black/10 dark:border-white/10'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export type NetworkFallbackChoiceSource = 'wallet' | 'context' | 'default' | 'human';

export function NetworkFallbackChoice({
  network,
  source,
  onChange,
  disabled = false,
  context = 'this import',
}: {
  network: StellarNetwork;
  source: NetworkFallbackChoiceSource;
  onChange: (network: StellarNetwork) => void;
  disabled?: boolean;
  context?: string;
}) {
  const fixedNetwork = fixedClientStellarDeploymentNetwork();
  if (fixedNetwork) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-black/[0.025] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="text-sm font-semibold">This deployment is restricted to one Stellar network.</div>
        <NetworkFact network={fixedNetwork} long />
      </div>
    );
  }
  const testnet = network === 'testnet';
  const label = testnet ? 'Testnet' : 'Mainnet';
  const alternate: StellarNetwork = testnet ? 'public' : 'testnet';
  const alternateLabel = alternate === 'testnet' ? 'Testnet' : 'Mainnet';
  const title = source === 'wallet'
    ? `Using your wallet network: ${label}`
    : source === 'context'
      ? `Using current workspace network: ${label}`
      : source === 'default'
        ? `Using ${label} by default`
        : `Using ${label} for ${context}`;
  const containerClass = testnet
    ? 'border-sky-500/25 bg-sky-500/[0.07]'
    : 'border-black/10 bg-black/[0.025] dark:border-white/10 dark:bg-white/[0.03]';
  const actionClass = alternate === 'testnet'
    ? 'text-sky-700 hover:bg-sky-500/10 dark:text-sky-300'
    : 'text-neutral-700 hover:bg-black/5 dark:text-neutral-200 dark:hover:bg-white/10';

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${containerClass}`}>
      <div className="text-sm font-semibold">{title}</div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(alternate)}
        className={`rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${actionClass}`}
      >
        Use {alternateLabel} instead
      </button>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  icon,
  title,
  description,
  meta,
  actions,
}: {
  eyebrow?: ReactNode;
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mst-page-header">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm font-bold">{eyebrow}</div>}
        <div className="mst-page-header__title-row">
          {icon && <div className="shrink-0 text-neutral-400">{icon}</div>}
          <h1 className="mst-page-title">{title}</h1>
        </div>
        {description && <div className="mst-page-header__description">{description}</div>}
        {meta && <div className="mst-page-header__meta">{meta}</div>}
      </div>
      {actions && <div className="mst-page-header__actions">{actions}</div>}
    </header>
  );
}

export function WorkflowProgress({
  current,
  label = 'Transaction progress',
}: {
  current: HumanWorkflowStage;
  label?: string;
}) {
  const currentIndex = HUMAN_WORKFLOW_STEPS.findIndex((step) => step.key === current);
  return (
    <nav className="mst-workflow-progress" aria-label={label}>
      {HUMAN_WORKFLOW_STEPS.map((step, index) => {
        const complete = index < currentIndex || (current === 'done' && index === currentIndex);
        const active = index === currentIndex;
        return (
          <div
            key={step.key}
            aria-current={active ? 'step' : undefined}
            data-complete={complete ? 'true' : 'false'}
            data-active={active ? 'true' : 'false'}
            className="mst-workflow-step"
          >
            <span className="mst-workflow-step__marker" aria-hidden="true">
              {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.number}
            </span>
            {step.label}
          </div>
        );
      })}
    </nav>
  );
}
