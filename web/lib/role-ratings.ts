import type { RoleDefinition, RoleRating } from './scout-api.ts';

export const roleLabel = (role: RoleDefinition) =>
  `${role.name} (${role.duty[0].toUpperCase()}${role.duty.slice(1)})`;

export const formatRoleScore = (score: number | null | undefined) =>
  score == null ? '—' : score.toFixed(1);

export const roleAbbreviation = (role: RoleDefinition) => role.role === 'anchor' ? 'A' : role.role.toUpperCase();

export const formatBestRole = (score: number | null | undefined, role: RoleDefinition | undefined) =>
  score == null || !role ? '—' : `${formatRoleScore(score)} (${roleAbbreviation(role)})`;

export function selectRole(
  filters: Record<string, string>, sort: string, direction: string, role: string,
) {
  return {
    filters: { ...filters, role, roleMin: role ? filters.roleMin ?? '' : '' },
    sort: role ? 'roleRating' : sort === 'roleRating' ? 'pa' : sort,
    direction: role || sort === 'roleRating' ? 'desc' : direction,
    page: 1,
  };
}

export function playerQuery(
  filters: Record<string, string>, sort: string, direction: string, page: number, limit: string,
  roles: string[] = [], bestRole = false,
) {
  const params = new URLSearchParams({ sort, direction, page: String(page), limit });
  for (const [key, value] of Object.entries(filters)) {
    if (value && key !== 'positionMatch') params.set(key, value);
  }
  if (filters.position) params.set('positionMatch', filters.positionMatch || 'and');
  if (roles.length) params.set('roles', [...new Set(roles)].join(','));
  if (bestRole) params.set('bestRole', '1');
  return params.toString();
}

export function rankedRoles(roles: RoleDefinition[], ratings: RoleRating[], search: string) {
  const byId = new Map(ratings.map(r => [r.roleId, r]));
  const query = search.trim().toLocaleLowerCase();
  return roles
    .filter(role => `${roleLabel(role)} ${role.id}`.toLocaleLowerCase().includes(query))
    .map(role => ({ role, rating: byId.get(role.id) }))
    .sort((a, b) =>
      (b.rating?.score ?? -1) - (a.rating?.score ?? -1) || roleLabel(a.role).localeCompare(roleLabel(b.role)),
    );
}
