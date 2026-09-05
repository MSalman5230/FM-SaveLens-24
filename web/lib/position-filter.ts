export type PositionMatch = 'and' | 'or';

export const defaultPositionFilters = { position: '', positionMatch: 'and' };

export function positionMatchOf(value: string | undefined): PositionMatch {
  return value === 'or' ? 'or' : 'and';
}

export function selectedPositions(position: string) {
  return position ? position.split(',') : [];
}

export function selectPositions(
  filters: Record<string, string>, positions: string[],
  match: PositionMatch = positionMatchOf(filters.positionMatch),
) {
  const position = [...new Set(positions)].sort((a, b) => Number(a) - Number(b)).join(',');
  return {
    filters: { ...filters, position, positionMatch: position ? match : 'and' },
    page: 1,
  };
}

export function activeFilterCount(filters: Record<string, string>) {
  return Object.entries(filters).filter(([key, value]) => key !== 'positionMatch' && value).length;
}

export function advancedFilterCount(filters: Record<string, string>) {
  const bounds = ['roleMin', 'ageMin', 'ageMax', 'caMin', 'caMax', 'paMin', 'paMax'];
  return Object.entries(filters).filter(([key, value]) => value && (bounds.includes(key) || key.startsWith('attr_'))).length
    + (selectedPositions(filters.position ?? '').length >= 2 && filters.positionMatch === 'or' ? 1 : 0);
}
