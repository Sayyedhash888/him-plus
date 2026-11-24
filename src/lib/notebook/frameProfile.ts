/**
 * Pure helpers for the automatic DataFrame wrangler: focusing the newest frame,
 * column profiling and small inline histograms over the captured preview rows.
 */

export type ColumnKind = 'number' | 'boolean' | 'datetime' | 'text' | 'other';

export function columnKind(dtype: string): ColumnKind {
  const value = (dtype || '').toLowerCase();
  if (/bool/.test(value)) return 'boolean';
  if (/datetime|timestamp|date|time/.test(value)) return 'datetime';
  if (/int|uint|float|decimal|double|complex|number/.test(value)) return 'number';
  if (/object|string|category|str/.test(value)) return 'text';
  return 'other';
}

function numericValues(values: unknown[]): number[] {
  const numbers: number[] = [];
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(number)) numbers.push(number);
  }
  return numbers;
}

export function numericBins(values: unknown[], binCount = 12): number[] {
  const numbers = numericValues(values);
  const bins = Math.max(1, Math.min(40, Math.floor(binCount)));
  const counts = new Array<number>(bins).fill(0);
  if (numbers.length === 0) return counts;
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  if (min === max) {
    counts[0] = numbers.length;
    return counts;
  }
  const span = max - min;
  for (const number of numbers) {
    const index = Math.min(bins - 1, Math.floor(((number - min) / span) * bins));
    counts[index] += 1;
  }
  return counts;
}

export function numericStats(values: unknown[]): {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  std: number | null;
} {
  const numbers = numericValues(values);
  if (numbers.length === 0) return { count: 0, min: null, max: null, mean: null, std: null };
  const sum = numbers.reduce((total, value) => total + value, 0);
  const mean = sum / numbers.length;
  const variance =
    numbers.reduce((total, value) => total + (value - mean) ** 2, 0) / numbers.length;
  return {
    count: numbers.length,
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    mean,
    std: Math.sqrt(variance),
  };
}

export function topValues(values: unknown[], limit = 6): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const key = String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(1, limit))
    .map(([value, count]) => ({ value, count }));
}

/** Picks the frame to focus automatically: the newest one, else the last. */
export function chooseFocusFrame(names: string[], previousNames: string[]): string | null {
  if (names.length === 0) return null;
  const fresh = names.find((name) => !previousNames.includes(name));
  return fresh || names[names.length - 1];
}

export function formatCompact(value: number | string | null | undefined): string {
  const number = typeof value === 'string' ? Number(value) : value;
  if (number === null || number === undefined || !Number.isFinite(number)) return '—';
  const absolute = Math.abs(number);
  if (absolute >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(number / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `${(number / 1_000).toFixed(2)}K`;
  if (absolute > 0 && absolute < 0.001) return number.toExponential(2);
  return Number.isInteger(number) ? String(number) : number.toFixed(3);
}

export function formatPercent(part: number, total: number): string {
  if (!total) return '0%';
  const pct = (part / total) * 100;
  return pct >= 10 ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
}
