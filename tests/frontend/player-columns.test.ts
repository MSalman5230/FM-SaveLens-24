import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import type { RoleCatalog } from '../../web/lib/scout-api.ts';
import { columnMatches, defaultColumns, normalizeColumns, playerColumns, restoreColumns, restoreColumnPreferences, resolveColumnSort, sortAfterColumns, visibleSort } from '../../web/lib/player-columns.ts';
import { playerQuery, selectRole } from '../../web/lib/role-ratings.ts';
import { currentValue, resourceKey } from '../../web/lib/snapshot-request.ts';
import { playerSearchQuery } from '../../web/lib/rating-systems.ts';
import { PlayerPageCache } from '../../web/lib/player-page-cache.ts';
import type { Results } from '../../web/lib/scout-api.ts';

const catalog = JSON.parse(readFileSync(new URL('../../native/roles.json', import.meta.url), 'utf8')) as RoleCatalog;
const available = playerColumns(catalog.roles);

test('the view accepts all 85 roles together and each duty has its own sortable column', () => {
  const ids = normalizeColumns(available.map(c => c.id), available);
  assert.equal(ids.length, 93);
  assert.equal(new Set(ids).size, 93);
  for (const role of catalog.roles) {
    const column = available.find(c => c.roleId === role.id)!;
    assert.equal(column.sort, `role:${role.id}`);
    assert.ok(column.label.includes(role.name));
  }
  assert.ok(available.filter(c => columnMatches(c, 'advanced playmaker')).length >= 2);
  assert.equal(available.filter(c => columnMatches(c, 'target man')).length, 2);
  assert.equal(available.filter(c => columnMatches(c, 'advanced forward attack')).length, 1);
});

test('legacy preferences gain the best role once without reordering or restoring a removed column', () => {
  const legacy = ['name', 'role:ap-support', 'positions', 'pa', 'age'];
  const migrated = restoreColumnPreferences(null, JSON.stringify(legacy), available);
  assert.deepEqual(migrated, ['name', 'role:ap-support', 'positions', 'bestRoleRating', 'pa', 'age']);
  assert.deepEqual(restoreColumnPreferences(JSON.stringify(migrated), JSON.stringify(legacy), available), migrated);
  assert.deepEqual(restoreColumnPreferences(JSON.stringify(legacy), JSON.stringify(legacy), available), legacy);
  assert.deepEqual(restoreColumnPreferences(null, '["name","pa"]', available), ['name', 'pa', 'bestRoleRating']);
  for (const legacyRaw of [null, 'broken', '{}']) {
    assert.deepEqual(restoreColumnPreferences(null, legacyRaw, available), defaultColumns);
  }
  assert.deepEqual(restoreColumnPreferences('[]', JSON.stringify(legacy), available), ['name']);
  assert.equal(defaultColumns[defaultColumns.indexOf('positions') + 1], 'bestRoleRating');
});

test('best role sorting survives system reconciliation and falls back when its column is removed', () => {
  assert.equal(available.find(column => column.id === 'bestRoleRating')?.sort, 'bestRoleRating');
  for (const direction of ['asc', 'desc']) {
    assert.deepEqual(resolveColumnSort(defaultColumns, 'bestRoleRating', direction, 'af-attack'), { sort: 'bestRoleRating', direction });
  }
  assert.deepEqual(resolveColumnSort(defaultColumns.filter(id => id !== 'bestRoleRating'), 'bestRoleRating', 'asc', ''), { sort: 'pa', direction: 'desc' });
});

test('saved views restore order, deduplicate roles, discard unknown columns and retain player names', () => {
  const selected = ['role:af-attack', 'role:tf-support', 'age', 'role:ap-support'];
  const restored = restoreColumns(JSON.stringify(selected), available);
  assert.deepEqual(restored, ['name', ...selected]);
  assert.deepEqual(restoreColumns(JSON.stringify(restored), available), restored);
  assert.deepEqual(restoreColumns('["name","role:bad",null,"age","age"]', available), ['name', 'age']);
  for (const raw of [null, 'broken', '{}', 'null']) assert.deepEqual(restoreColumns(raw, available), defaultColumns);
  assert.deepEqual(normalizeColumns([], available), ['name']);
});

test('changing displayed roles preserves filters and supports sorting independently of the filter role', () => {
  const filters = { q: 'Ali', club: '42', position: '12', role: 'af-attack', roleMin: '70.5' };
  const roles = ['af-attack', 'ap-support', 'tf-support', 'af-attack'];
  const params = new URLSearchParams(playerQuery(filters, 'role:tf-support', 'asc', 3, '50', roles));
  assert.equal(params.get('roles'), 'af-attack,ap-support,tf-support');
  assert.equal(params.get('sort'), 'role:tf-support');
  assert.equal(params.get('page'), '3');
  for (const [key, value] of Object.entries(filters)) assert.equal(params.get(key), value);
  const noColumns = new URLSearchParams(playerQuery(filters, 'pa', 'desc', 1, '50'));
  assert.equal(noColumns.has('roles'), false);
  assert.equal(noColumns.get('role'), 'af-attack');
});

test('removing the sorted column restores a visible sort without disturbing other sorts', () => {
  assert.equal(visibleSort('roleRating', 'af-attack'), 'role:af-attack');
  assert.equal(sortAfterColumns(['name', 'role:af-attack'], 'roleRating', 'af-attack'), 'roleRating');
  assert.equal(sortAfterColumns(defaultColumns, 'role:tf-support', 'af-attack'), 'pa');
  assert.equal(sortAfterColumns(['name', 'role:ap-support'], 'role:tf-support', ''), 'name');
  assert.equal(sortAfterColumns(defaultColumns, 'club', ''), 'club');
});

test('restored views choose a visible default sort, including invalid saved preferences', () => {
  for (const raw of ['["name","role:af-attack"]', '[]', '["role:unknown"]']) {
    const ids = restoreColumns(raw, available);
    assert.deepEqual(resolveColumnSort(ids, 'pa', 'desc', ''), { sort: 'name', direction: 'asc' });
  }
  for (const raw of [JSON.stringify(defaultColumns), null, 'broken', '{}', 'null']) {
    const ids = restoreColumns(raw, available);
    assert.deepEqual(ids, defaultColumns);
    assert.deepEqual(resolveColumnSort(ids, 'pa', 'desc', ''), { sort: 'pa', direction: 'desc' });
  }
});

test('column edits preserve visible sort directions and reset directions on fallback', () => {
  const ids = [...defaultColumns, 'role:af-attack', 'role:tf-support'];
  for (const direction of ['asc', 'desc']) {
    for (const sort of ['name', 'club', 'pa', 'roleRating', 'role:tf-support']) {
      assert.deepEqual(resolveColumnSort(ids, sort, direction, 'af-attack'), { sort, direction });
    }
  }
  assert.deepEqual(resolveColumnSort(defaultColumns, 'role:tf-support', 'asc', ''), { sort: 'pa', direction: 'desc' });
  assert.deepEqual(resolveColumnSort(['name', 'role:af-attack'], 'pa', 'desc', ''), { sort: 'name', direction: 'asc' });
});

test('selecting a role includes its column before resolving the descending rank', () => {
  const filters = { q: 'Ali', club: '42', position: '12', role: '', roleMin: '' };
  const role = 'af-attack';
  const ids = normalizeColumns(['name', `role:${role}`], available);
  const selected = selectRole(filters, 'name', 'asc', role);
  const sorting = resolveColumnSort(ids, selected.sort, selected.direction, selected.filters.role);
  assert.deepEqual(sorting, { sort: 'roleRating', direction: 'desc' });
  assert.ok(ids.includes(visibleSort(sorting.sort, role)));
  assert.deepEqual(selected.filters, { ...filters, role });
  assert.equal(selected.page, 1);
});

test('clearing role filters falls back visibly while retaining independent visible sorts', () => {
  const filters = { q: 'Ali', club: '42', role: 'af-attack', roleMin: '70.5' };
  const cleared = selectRole(filters, 'roleRating', 'asc', '');
  assert.deepEqual(cleared.filters, { ...filters, role: '', roleMin: '' });
  assert.equal(cleared.page, 1);
  for (const [ids, expected] of [
    [defaultColumns, { sort: 'pa', direction: 'desc' }],
    [['name', 'role:af-attack'], { sort: 'name', direction: 'asc' }],
  ] as const) {
    assert.deepEqual(resolveColumnSort([...ids], cleared.sort, cleared.direction, ''), expected);
    // Resetting all filters clears the role before resolving the current sort.
    assert.deepEqual(resolveColumnSort([...ids], 'roleRating', 'asc', ''), expected);
  }
  const independent = selectRole(filters, 'role:tf-support', 'asc', '');
  assert.deepEqual(resolveColumnSort(['name', 'role:tf-support'], independent.sort, independent.direction, ''), {
    sort: 'role:tf-support', direction: 'asc',
  });
});

test('browser search and the table share rated queries, scoped results and one cached request', async () => {
  for (const withPA of [true, false]) {
    const ids = withPA ? [...defaultColumns, 'role:af-attack'] : ['name', 'role:af-attack'];
    const sorting = resolveColumnSort(ids, 'pa', 'desc', '');
    const filters = { q: 'Ali', paMin: '150', role: '', roleMin: '' };
    const identity = { systemId: 'custom-forward', systemRevision: 7 };
    const bestRole = ids.includes('bestRoleRating');
    const query = playerSearchQuery(filters, sorting.sort, sorting.direction, 1, '50', ['af-attack'], bestRole, identity);
    const expectedParams = new URLSearchParams({
      sort: withPA ? 'pa' : 'name', direction: withPA ? 'desc' : 'asc', page: '1', limit: '50',
      q: 'Ali', paMin: '150', roles: 'af-attack',
    });
    if (bestRole) expectedParams.set('bestRole', '1');
    expectedParams.set('systemId', identity.systemId);
    expectedParams.set('systemRevision', String(identity.systemRevision));
    const expected = expectedParams.toString();
    assert.equal(query, expected);
    const cache = new PlayerPageCache('saveA', identity);
    let calls = 0;
    const request = async (path: string): Promise<Results> => {
      calls++;
      const params = new URLSearchParams(path.split('?')[1]);
      assert.equal(params.get('bestRole'), bestRole ? '1' : null);
      assert.equal(params.get('roles'), 'af-attack');
      assert.equal(params.get('systemId'), identity.systemId);
      assert.equal(params.get('systemRevision'), '7');
      return { ...identity, total: 0, players: [], page: 1, limit: 50 };
    };
    const found = await cache.load(query, request);
    const response = { key: resourceKey('saveA', query), value: found };
    assert.equal(currentValue(response, resourceKey('saveA', expected)), found);
    assert.deepEqual(cache.peek(expected), found);
    await cache.load(expected, request);
    assert.equal(calls, 1);
    const changedQuery = playerSearchQuery(filters, sorting.sort, sorting.direction, 1, '50', ['af-attack'], bestRole, { ...identity, systemRevision: 8 });
    assert.equal(currentValue(response, resourceKey('saveA', changedQuery)), null);
    assert.equal(cache.peek(changedQuery), null);
    cache.clear();
  }
});

test('responses for an old set of role columns cannot appear in the new view or save', () => {
  const oldQuery = playerQuery({}, 'pa', 'desc', 1, '50', ['af-attack']);
  const newQuery = playerQuery({}, 'pa', 'desc', 1, '50', ['af-attack', 'tf-support']);
  const data = { key: resourceKey('saveA', oldQuery), value: { roleScores: { 'af-attack': 80 } } };
  assert.equal(currentValue(data, resourceKey('saveA', newQuery)), null);
  assert.equal(currentValue(data, resourceKey('saveB', oldQuery)), null);
});
