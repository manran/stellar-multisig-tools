// Display only: preserve significant decimal digits without Number rounding.
export function displayAmount(value: string): string {
  const match = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(value);
  if (!match) return value;
  const [, sign, digits, fraction = ''] = match;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const significant = fraction.replace(/0+$/, '');
  return sign + grouped + (significant ? '.' + significant : '');
}

// Stable format and explicit timezone across the UI and printed receipts.
export function displayTimestamp(value: string | number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown time';
  return date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
}
export function displayDate(value: string | number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unknown date';
  return date.toISOString().slice(0, 10) + ' UTC';
}

export type TimeDisplayMode = 'local' | 'utc';

const pad = (value: number) => String(value).padStart(2, '0');

export function humanTimeParts(value: string | number, mode: TimeDisplayMode, dateOnly = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const utc = mode === 'utc';
  const offset = utc ? 0 : -date.getTimezoneOffset();
  const zone = offset === 0 ? 'UTC' : 'UTC' + (offset < 0 ? '-' : '+') + pad(Math.floor(Math.abs(offset) / 60)) + ':' + pad(Math.abs(offset) % 60);
  const day = utc ? date.toISOString().slice(0, 10) : [String(date.getFullYear()).padStart(4, '0'), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
  const clock = utc ? date.toISOString().slice(11, 19) : [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':');
  return { text: dateOnly ? day : day + ' ' + clock, zone, iso: date.toISOString() };
}

export function timeDisplayDetails(value: string | number): string {
  const local = humanTimeParts(value, 'local');
  const utc = humanTimeParts(value, 'utc');
  return local && utc ? 'Local: ' + local.text + ' ' + local.zone + '; UTC: ' + utc.text + ' UTC' : 'Unknown time';
}

export function recentEventLabel(value: string | number, now: number): string | null {
  const elapsed = now - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= 86400000) return null;
  if (elapsed < 60000) return 'Just now';
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return minutes + (minutes === 1 ? ' min ago' : ' mins ago');
  const hours = Math.floor(minutes / 60);
  return hours + (hours === 1 ? ' hour ago' : ' hours ago');
}

// A device-clock estimate for display, never a transaction status decision.
export function deadlineEstimate(value: string | number, now: number): { label: string; urgent: boolean } | null {
  const remaining = new Date(value).getTime() - now;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return { label: 'Check current status', urgent: true };
  if (remaining < 60000) return { label: 'Less than 1 min left', urgent: true };
  const minutes = Math.floor(remaining / 60000);
  if (minutes < 60) return { label: 'About ' + minutes + ' min left', urgent: true };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { label: 'About ' + hours + (hours === 1 ? ' hour left' : ' hours left'), urgent: remaining <= 3600000 };
  const days = Math.floor(hours / 24);
  return { label: 'About ' + days + ' days left', urgent: false };
}
