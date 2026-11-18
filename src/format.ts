/** Number and text formatting. Money amounts use bigint math, never floating point. */

/** Format `value` (an integer in the smallest unit) with `decimals`, truncated to `maxFraction` digits. */
export function formatUnits(value: bigint, decimals: number, maxFraction: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let fraction = (abs % base).toString().padStart(decimals, '0').slice(0, maxFraction);
  fraction = fraction.replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${text}` : text;
}

/** Wei to ETH with up to 6 decimals; amounts below the shown precision read "< 0.000001". */
export function formatEth(wei: bigint): string {
  if (wei > 0n && wei < 10n ** 12n) return '< 0.000001';
  return formatUnits(wei, 18, 6);
}

export function formatGwei(wei: bigint): string {
  if (wei > 0n && wei < 10n ** 7n) return '< 0.01';
  return formatUnits(wei, 9, 2);
}

export function formatUsd(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

/** Escape text for Telegram's HTML parse mode. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function shortHex(hex: string): string {
  return hex.length > 14 ? `${hex.slice(0, 8)}…${hex.slice(-6)}` : hex;
}

/** "5 minutes ago" style age from seconds. */
export function formatAge(seconds: number): string {
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}
