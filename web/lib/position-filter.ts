export type PositionMatch = 'and' | 'or';

export const defaultPositionFilters = { position: '', positionMatch: 'and' };

export function selectedPositions(position: string) {
  return position ? position.split(',') : [];
}

export function selectPositions(
  filters: Record<string, string>, positions: string[],
  match: PositionMatch = filters.positionMatch === 'or' ? 'or' : 'and',
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
