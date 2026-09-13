interface Props {
  className?: string;
}

export default function MultiSigBrandMark({ className = 'h-9 w-10' }: Props) {
  return (
    <svg viewBox="0 0 40 34" className={`${className} shrink-0 text-emerald-700 dark:text-emerald-300`} aria-hidden="true">
      <path d="M7 8.5 20 26 33 8.5" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.28" />
      <circle cx="7" cy="8.5" r="4.2" fill="currentColor" />
      <circle cx="20" cy="26" r="4.2" fill="currentColor" />
      <circle cx="33" cy="8.5" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.48" />
    </svg>
  );
}
