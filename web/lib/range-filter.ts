export const playerRanges = [
  { key: 'age', label: 'Age', max: 50 },
  { key: 'ca', label: 'Current ability', max: 200 },
  { key: 'pa', label: 'Potential ability', max: 200 },
] as const;

export type RangeBounds = [string, string];

export function rangeValues(bounds: RangeBounds, max: number): [number, number] {
  // Only the handles are capped; the search retains the manually entered bounds.
  return [Math.min(max, bounds[0] === '' ? 0 : Number(bounds[0])),
    Math.min(max, bounds[1] === '' ? max : Number(bounds[1]))];
}

export function commitRangeBound(bounds: RangeBounds, index: 0 | 1, raw: string): RangeBounds {
  const next: RangeBounds = [...bounds];
  if (raw.trim() === '') {
    next[index] = '';
    return next;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return next;
  const value = Math.max(0, Math.round(parsed));
  if (!Number.isSafeInteger(value)) return next;
  next[index] = String(value);
  const other = index === 0 ? 1 : 0;
  if (next[other] !== '' && (index === 0 ? value > Number(next[other]) : value < Number(next[other]))) {
    next[other] = String(value);
  }
  return next;
}
