import type { Attribute, RatingIdentity, RatingSystem, RoleCatalog, RoleDefinition } from './scout-api.ts';
import { normalizeColumns, playerColumns, resolveColumnSort } from './player-columns.ts';

export const builtinSystemId = 'role-highlighted-rating';
export const weightGroups = ['Technical', 'Mental', 'Physical', 'Goalkeeping', 'Feet', 'Consistency'];
export const weightGroup = (attribute: Attribute) => attribute.key === 'consistency' ? 'Consistency' : attribute.group;
export const weightAttributes = (attributes: Attribute[]) => attributes.filter(attribute =>
  ['Technical', 'Mental', 'Physical', 'Goalkeeping', 'Feet'].includes(attribute.group) || attribute.key === 'consistency');
export const roleWeights = (role: RoleDefinition): Record<string, number> => role.weights ?? Object.fromEntries([
  ...role.keyAttributes.map(key => [key, 2]), ...role.preferableAttributes.map(key => [key, 1]),
]);
export const weightDraft = (role: RoleDefinition) => Object.fromEntries(Object.entries(roleWeights(role)).map(([key, value]) => [key, String(value)]));
export const ratingIdentity = (catalog: RatingIdentity | null) => catalog ? `${catalog.systemId}:${catalog.systemRevision}` : '';
export const sameRatingSystem = (value: RatingIdentity, catalog: RatingIdentity | null) =>
  catalog !== null && value.systemId === catalog.systemId && value.systemRevision === catalog.systemRevision;
export const ratingParams = (catalog: RatingIdentity | null) => catalog
  ? new URLSearchParams({ systemId: catalog.systemId, systemRevision: String(catalog.systemRevision) }).toString() : '';

export function parseWeights(draft: Record<string, string>, attributes: Attribute[]): Record<string, number> {
  const allowed = new Set(weightAttributes(attributes).map(attribute => attribute.key));
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(draft)) {
    const value = Number(raw);
    if (!allowed.has(key) || raw.trim() === '' || !Number.isFinite(value) || value < 0)
      throw new Error('Enter a nonnegative number for every weight. Use 0 to exclude an attribute.');
    if (value > 0) result[key] = value;
  }
  const total = Object.values(result).reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0 || total > Number.MAX_VALUE / 100)
    throw new Error('Give at least one attribute a positive weight and keep the total finite.');
  return result;
}

export function editRole(system: RatingSystem, roleId: string, name: string, weights: Record<string, number>, newId?: string): RoleDefinition[] {
  const original = system.roles.find(role => role.id === roleId);
  const trimmed = name.trim();
  if (!original) throw new Error('Choose a role.');
  if (!trimmed || Array.from(trimmed).length > 100) throw new Error('Role names must contain 1–100 characters.');
  if (system.roles.some(role => (newId || role.id !== roleId) && role.duty === original.duty && role.name.toLowerCase() === trimmed.toLowerCase()))
    throw new Error('A role with this name and duty already exists in this system.');
  const edited = { ...original, id: newId ?? roleId, name: trimmed, weights: { ...weights } };
  return newId ? [...system.roles, edited] : system.roles.map(role => role.id === roleId ? edited : role);
}

export function reconcileRatingView(catalog: RoleCatalog, filters: Record<string, string>, columns: string[], sort: string, direction: string) {
  const role = catalog.roles.some(role => role.id === filters.role) ? filters.role : '';
  const nextFilters = { ...filters, role, roleMin: role ? filters.roleMin : '' };
  const columnIds = normalizeColumns(columns, playerColumns(catalog.roles));
  return { filters: nextFilters, columnIds, ...resolveColumnSort(columnIds, sort, direction, role), page: 1 };
}
