import { useSyncExternalStore } from 'react';
import { deadlineEstimate, humanTimeParts, recentEventLabel, timeDisplayDetails } from './stellar/displayFormat';
import type { TimeDisplayMode } from './stellar/displayFormat';

const storageKey = 'mst-time-display';
let mode: TimeDisplayMode | undefined;
const modeListeners = new Set<() => void>();

function readMode(): TimeDisplayMode {
  if (mode === undefined) {
    try { mode = localStorage.getItem(storageKey) === 'utc' ? 'utc' : 'local'; }
    catch { mode = 'local'; }
  }
  return mode;
}
function notifyMode() { for (const listener of modeListeners) listener(); }
function storageChanged(event: StorageEvent) {
  if (event.key !== storageKey && event.key !== null) return;
  mode = event.newValue === 'utc' ? 'utc' : 'local';
  notifyMode();
}
function subscribeMode(listener: () => void) {
  if (!modeListeners.size) {
    window.addEventListener('storage', storageChanged);
    // A preference may have changed while no time component was mounted.
    try { mode = localStorage.getItem(storageKey) === 'utc' ? 'utc' : 'local'; } catch { /* Keep the in-memory choice. */ }
  }
  modeListeners.add(listener);
  return () => {
    modeListeners.delete(listener);
    if (!modeListeners.size) window.removeEventListener('storage', storageChanged);
  };
}
function toggleMode() {
  mode = readMode() === 'utc' ? 'local' : 'utc';
  try { localStorage.setItem(storageKey, mode); } catch { /* Still switch within this tab. */ }
  notifyMode();
}

// A single local clock for all relative labels. Absolute times do not subscribe.
let clock = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const clockListeners = new Set<() => void>();
const clockSnapshot = () => clock;
function tick() {
  clock = Date.now();
  for (const listener of clockListeners) listener();
}
function subscribeClock(listener: () => void) {
  if (!clockListeners.size) {
    clock = Date.now();
    timer = setInterval(tick, 15000);
    window.addEventListener('focus', tick);
  }
  clockListeners.add(listener);
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size) {
      clearInterval(timer);
      timer = undefined;
      window.removeEventListener('focus', tick);
    }
  };
}
const noClock = () => () => {};
function useTimeMode() { return useSyncExternalStore(subscribeMode, readMode, () => 'local' as const); }

export function TimeZoneControl() {
  const current = useTimeMode();
  return <button type="button" className="mst-time-zone-control" aria-label={current === 'local' ? 'Switch all times to UTC' : 'Switch all times to local time'} title="Change the time display across MultiSig Tools" onClick={toggleMode}>
    {current === 'local' ? 'Local time' : 'UTC time'}
  </button>;
}

interface TimeProps {
  value: string | number;
  relative?: boolean;
  dateOnly?: boolean;
  // Use inside an existing card button or summary; never nest buttons.
  passive?: boolean;
  className?: string;
}

export function HumanTime({ value, relative = false, dateOnly = false, passive = false, className = '' }: TimeProps) {
  const current = useTimeMode();
  const useRelative = relative && current === 'local' && !dateOnly;
  const now = useSyncExternalStore(useRelative ? subscribeClock : noClock, clockSnapshot, clockSnapshot);
  const selected = humanTimeParts(value, current, dateOnly);
  if (!selected) return <span className={className}>Unknown time</span>;
  const label = (useRelative && recentEventLabel(value, now)) || selected.text;
  const details = timeDisplayDetails(value);
  const next = current === 'local' ? 'UTC' : 'local time';
  return <span className={'mst-human-time ' + className}>
    <time dateTime={selected.iso} title={details}>{label}</time>{' '}
    {passive ? <span title={details}>{selected.zone}</span> :
      <><button type="button" className="mst-time-zone-control" title={details + '. Switch to ' + next} aria-label={details + '. Switch all times to ' + next} onClick={toggleMode}>{selected.zone}</button><span className="mst-time-focus-detail" aria-hidden="true">{details}</span></>}
  </span>;
}

export function HumanDeadline({ value, passive = false, className = '' }: Pick<TimeProps, 'value' | 'passive' | 'className'>) {
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, clockSnapshot);
  const estimate = deadlineEstimate(value, now);
  return <span className={'mst-human-deadline ' + className}>
    <HumanTime value={value} passive={passive} />
    {estimate && <> · <span className={estimate.urgent ? 'font-semibold text-[var(--color-danger)]' : 'font-medium'} title="Estimated from your device clock; refresh to confirm status">{estimate.label}</span></>}
  </span>;
}
