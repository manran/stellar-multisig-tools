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
