/**
 * Shared formatting utilities used across dashboard pages.
 */

/** Format hashrate from TH/s to the most readable unit. */
export function fmtHash(ths: number): string {
  if (ths >= 1) return `${ths.toFixed(2)} TH/s`;
  if (ths >= 0.001) return `${(ths * 1000).toFixed(1)} GH/s`;
  if (ths > 0) return `${(ths * 1e6).toFixed(0)} MH/s`;
  return '0 H/s';
}

/** Format a large number with K/M/G/T/P/E suffixes. */
export function fmtCompact(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  const suffixes = ['', 'K', 'M', 'G', 'T', 'P', 'E'];
  let scaled = value;
  let suffixIndex = 0;
  while (scaled >= 1000 && suffixIndex < suffixes.length - 1) {
    scaled /= 1000;
    suffixIndex += 1;
  }
  const decimals = suffixIndex === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : digits;
  return `${scaled.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals })}${suffixes[suffixIndex]}`;
}

/** Format a difficulty value with K/M/G/T/P/E suffixes. */
export function formatDiff(value: number | null | undefined): string {
  if (!value || value <= 0) return '—';
  const suffixes = ['', 'K', 'M', 'G', 'T', 'P', 'E'];
  let scaled = value;
  let suffixIndex = 0;
  while (scaled >= 1000 && suffixIndex < suffixes.length - 1) {
    scaled /= 1000;
    suffixIndex += 1;
  }
  if (suffixIndex === 0) {
    return scaled.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })}${suffixes[suffixIndex]}`;
}

/** Format a number with fixed decimals, returning '—' for invalid values. */
export function fmt(value: number | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

/** Format a timestamp as relative time (e.g. "2 h ago" / « il y a 2 h »). */
export function formatTime(ts: number, lang: 'fr' | 'en' = 'en'): string {
  const date = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - ts;
  const fr = lang === 'fr';
  const locale = fr ? 'fr-FR' : 'en-US';
  if (diff < 60_000) return fr ? 'à l’instant' : 'just now';
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return fr ? `il y a ${m} min` : `${m} min ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return fr ? `il y a ${h} h` : `${h} h ago`;
  }
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return `${date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
}

/** Format a timestamp as a locale date string. */
export function formatDate(value: number | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

/** Return a CSS color variable based on temperature severity. */
export function tempColor(value: number): string {
  if (value >= 85) return 'var(--danger)';
  if (value >= 70) return 'var(--warning)';
  return 'var(--success)';
}

/** Return a CSS color variable based on health score. */
export function healthColor(score: number): string {
  if (score >= 80) return 'var(--success)';
  if (score >= 55) return 'var(--warning)';
  return 'var(--danger)';
}
