export type Attribute = {
  key: string;
  label: string;
  group: string;
  inverted: boolean;
};
export type Option = { value: string; label: string; description?: string };
export type SaveFile = {
  id: string;
  name: string;
  size: number;
  modified: string;
  snapshotId: string;
  cached: boolean;
};
export type Job = {
  id: string;
  saveId: string;
  snapshotId: string;
  status: 'running' | 'complete' | 'error' | 'cancelled';
  progress: number;
  message: string;
};
export type Snapshot = {
  snapshotId: string;
  name: string;
  gameDate: string;
  sourceName: string;
  playerCount: number;
  stale: boolean;
  warnings: string[];
  clubs: { id: number; name: string }[];
  nations: { id: number; name: string }[];
  diagnostics: Record<string, number>;
};
export type Player = {
  id: number;
  uid: number;
  name: string;
  age: number;
  club: string | null;
  nationalities: string[];
  positions: string[];
  ca: number;
  pa: number;
  roleRating?: number | null;
  roleScores?: Record<string, number | null>;
};
export type Detail = Player & {
  fullName: string;
  birthDate: string;
  positionRatings: number[];
  attributes: Record<string, number | null>;
  roleRatings: RoleRating[];
};
export type RoleDefinition = {
  id: string;
  role: string;
  name: string;
  duty: 'defend' | 'support' | 'attack' | 'stopper' | 'cover';
  group: string;
  keyAttributes: string[];
  preferableAttributes: string[];
  source: string;
  sourceRole: string;
};
export type RoleRating = {
  roleId: string;
  score: number | null;
  missingAttributes: string[];
};
export type RoleCatalog = {
  version: string;
  modelVersion: string;
  gameVersion: string;
  keyWeight: number;
  preferableWeight: number;
  scale: number;
  sources: { id: string; title: string; url: string; accessed?: string }[];
  roles: RoleDefinition[];
};
export type Results = {
  total: number;
  page: number;
  limit: number;
  players: Player[];
};
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch('/api' + path, { ...init, headers });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(value.error || `Request failed (${response.status})`);
  return value;
}
export const date = (value: string) =>
  new Date(
    value.length === 10 ? value + 'T12:00:00' : value,
  ).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
export const size = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : `${(bytes / 1e6).toFixed(0)} MB`;
