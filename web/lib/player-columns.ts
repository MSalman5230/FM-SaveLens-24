import type { RoleDefinition } from './scout-api.ts';
import { roleLabel } from './role-ratings.ts';

export type PlayerColumn = { id: string; label: string; sort?: string; roleId?: string; group: string; keywords?: string };
export const defaultColumns = ['name', 'age', 'club', 'nationalities', 'positions', 'bestRoleRating', 'ca', 'pa'];
export const legacyColumnStorageKey = 'savelens.player-columns.v1';
export const columnStorageKey = 'savelens.player-columns.v2';

export function playerColumns(roles: RoleDefinition[]): PlayerColumn[] {
  return [
    { id: 'name', label: 'Player', sort: 'name', group: 'Player details' },
    { id: 'age', label: 'Age', sort: 'age', group: 'Player details' },
    { id: 'club', label: 'Club', sort: 'club', group: 'Player details' },
    { id: 'nationalities', label: 'Nationality', group: 'Player details' },
    { id: 'positions', label: 'Position', group: 'Player details' },
    { id: 'bestRoleRating', label: 'Best role rating', sort: 'bestRoleRating', group: 'Player details' },
    { id: 'ca', label: 'CA', sort: 'ca', group: 'Player details' },
    { id: 'pa', label: 'PA', sort: 'pa', group: 'Player details' },
    ...roles.map(role => ({
      id: `role:${role.id}`, label: roleLabel(role), sort: `role:${role.id}`,
      roleId: role.id, group: role.group, keywords: role.role === 'tf' ? 'target man' : '',
    })).sort((a, b) => a.label.localeCompare(b.label)),
  ];
}

export function normalizeColumns(value: unknown, available: PlayerColumn[]): string[] {
  if (!Array.isArray(value)) return [...defaultColumns];
  const known = new Set(available.map(column => column.id));
  return ['name', ...new Set(value.filter((id): id is string => typeof id === 'string' && id !== 'name' && known.has(id)))];
}

export function restoreColumns(raw: string | null, available: PlayerColumn[]): string[] {
  try { return raw === null ? [...defaultColumns] : normalizeColumns(JSON.parse(raw), available); }
  catch { return [...defaultColumns]; }
}

export function restoreColumnPreferences(raw: string | null, legacyRaw: string | null, available: PlayerColumn[]): string[] {
  if (raw !== null) return restoreColumns(raw, available);
  const ids = restoreColumns(legacyRaw, available);
  if (!ids.includes('bestRoleRating')) {
    const position = ids.indexOf('positions');
    ids.splice(position >= 0 ? position + 1 : ids.length, 0, 'bestRoleRating');
  }
  return ids;
}

export function columnMatches(column: PlayerColumn, search: string): boolean {
  const text = `${column.label} ${column.group} ${column.keywords ?? ''}`.toLocaleLowerCase();
  return search.trim().toLocaleLowerCase().split(/\s+/).every(word => text.includes(word));
}

export function visibleSort(sort: string, selectedRole: string): string {
  return sort === 'roleRating' ? `role:${selectedRole}` : sort;
}

export function sortAfterColumns(ids: string[], sort: string, selectedRole: string): string {
  return ids.includes(visibleSort(sort, selectedRole)) ? sort : ids.includes('pa') ? 'pa' : 'name';
}

export function resolveColumnSort(ids: string[], sort: string, direction: string, selectedRole: string) {
  const nextSort = sortAfterColumns(ids, sort, selectedRole);
  return {
    sort: nextSort,
    direction: nextSort === sort ? direction : nextSort === 'name' ? 'asc' : 'desc',
  };
}
