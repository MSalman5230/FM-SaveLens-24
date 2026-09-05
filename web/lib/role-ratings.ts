import type { RoleDefinition, RoleRating } from './scout-api.ts';

export const roleLabel = (role: RoleDefinition) =>
  `${role.name} (${role.duty[0].toUpperCase()}${role.duty.slice(1)})`;

export const formatRoleScore = (score: number | null | undefined) =>
  score == null ? '—' : score.toFixed(1);

// Internal role aliases can differ from the abbreviations displayed in FM24.
const roleAbbreviations: Record<string, string> = {
  gk: 'G',
  anchor: 'A',
  wtf: 'WT',
  reg: 'RGA',
  sv: 'VOL',
  eng: 'EG',
  lib: 'L',
};

export const roleAbbreviation = (role: RoleDefinition) =>
  roleAbbreviations[role.role] ?? role.role.toUpperCase();

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

export const rolePositionGroups = [
  'Central defenders',
  'Full-backs and wing-backs',
  'Central and defensive midfielders',
  'Wide roles',
  'Attacking midfielders and forwards',
  'Goalkeepers',
];

const dutyOrder = ['defend', 'stopper', 'cover', 'support', 'attack'];
export type RoleFamily = {
  id: string;
  name: string;
  rows: ReturnType<typeof rankedRoles>;
  bestScore: number | null;
};

export function eligiblePlayerRoles(roles: RoleDefinition[], positionRatings: number[]) {
  const goalkeeper = (positionRatings[0] ?? 0) >= 15;
  return roles.filter(role => (role.group === 'Goalkeepers') === goalkeeper);
}

export function groupedRoles(roles: RoleDefinition[], ratings: RoleRating[], search: string) {
  const groups = new Map<string, Map<string, RoleFamily>>();
  for (const row of rankedRoles(roles, ratings, '')) {
    const { role, rating } = row;
    // Custom profiles can share a base role while having distinct names and weights.
    const id = JSON.stringify([role.group, role.role, role.name]);
    const families = groups.get(role.group) ?? new Map<string, RoleFamily>();
    const family = families.get(id) ?? { id, name: role.name, rows: [], bestScore: null };
    family.rows.push(row);
    if (rating?.score != null) family.bestScore = Math.max(family.bestScore ?? -1, rating.score);
    families.set(id, family);
    groups.set(role.group, families);
  }
  const query = search.trim().toLocaleLowerCase();
  return [...groups].map(([name, families]) => ({
    name,
    families: [...families.values()]
      .sort((a, b) => (b.bestScore ?? -1) - (a.bestScore ?? -1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map(family => ({ ...family, rows: family.rows
        .filter(({ role }) => `${roleLabel(role)} ${role.id} ${role.group}`.toLocaleLowerCase().includes(query))
        .sort((a, b) => dutyOrder.indexOf(a.role.duty) - dutyOrder.indexOf(b.role.duty) || a.role.id.localeCompare(b.role.id)),
      }))
      .filter(family => family.rows.length),
  }))
    .filter(group => group.families.length)
    .sort((a, b) => {
      const order = (name: string) => {
        const index = rolePositionGroups.indexOf(name);
        return index < 0 ? rolePositionGroups.length : index;
      };
      return order(a.name) - order(b.name) || a.name.localeCompare(b.name);
    });
}
