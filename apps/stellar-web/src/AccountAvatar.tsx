import { StrKey } from '@stellar/stellar-sdk/base';

/** SEP-33-style symmetric identicon for G-addresses; MST User IDs use the same visual grammar. */
function avatarBytes(value: string): number[] {
  if (StrKey.isValidEd25519PublicKey(value)) return [...StrKey.decodeEd25519PublicKey(value).slice(2, 16)];
  let hash = 2166136261;
  const bytes: number[] = [];
  for (let index = 0; index < 14; index++) {
    for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    hash = Math.imul(hash ^ index, 16777619) >>> 0;
    bytes.push(hash & 255);
  }
  return bytes;
}

export default function AccountAvatar({ value, className = 'h-10 w-10', label }: {
  value: string; className?: string; label?: string;
}) {
  const bytes = avatarBytes(value);
  const hue = Math.round(bytes[0] * 360 / 256);
  const blocks = Array.from({ length: 7 }, (_, y) =>
    Array.from({ length: 7 }, (_, x) => {
      const column = x <= 3 ? x : 6 - x;
      const bit = column * 7 + y;
      return (bytes[1 + Math.floor(bit / 8)] & (1 << (bit % 8))) !== 0 ? { x, y } : null;
    }).filter((cell): cell is { x: number; y: number } => cell !== null),
  ).flat();
  return <svg className={className} viewBox="0 0 7 7" role={label ? 'img' : undefined}
    aria-label={label} aria-hidden={label ? undefined : true} xmlns="http://www.w3.org/2000/svg"
    style={{ borderRadius: '22%', backgroundColor: 'var(--color-paper-2)', flexShrink: 0 }}>
    {blocks.map(({ x, y }) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1"
      fill={`hsl(${hue} 70% 56%)`} />)}
  </svg>;
}
