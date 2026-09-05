import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import type { RoleCatalog } from '../../web/lib/scout-api.ts';
import { columnMatches, defaultColumns, normalizeColumns, playerColumns, restoreColumns, sortAfterColumns, visibleSort } from '../../web/lib/player-columns.ts';
import { playerQuery } from '../../web/lib/role-ratings.ts';
import { currentValue, resourceKey } from '../../web/lib/snapshot-request.ts';

const catalog = JSON.parse(readFileSync(new URL('../../native/roles.json', import.meta.url), 'utf8')) as RoleCatalog;
const available = playerColumns(catalog.roles);

test('the view accepts all 85 roles together and each duty has its own sortable column', () => {
  const ids = normalizeColumns(available.map(c => c.id), available);
  assert.equal(ids.length, 92);
  assert.equal(new Set(ids).size, 92);
  for (const role of catalog.roles) {
    const column = available.find(c => c.roleId === role.id)!;
    assert.equal(column.sort, `role:${role.id}`);
    assert.ok(column.label.includes(role.name));
  }
  assert.ok(available.filter(c => columnMatches(c, 'advanced playmaker')).length >= 2);
  assert.equal(available.filter(c => columnMatches(c, 'target man')).length, 2);
  assert.equal(available.filter(c => columnMatches(c, 'advanced forward attack')).length, 1);
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

test('responses for an old set of role columns cannot appear in the new view or save', () => {
  const oldQuery = playerQuery({}, 'pa', 'desc', 1, '50', ['af-attack']);
  const newQuery = playerQuery({}, 'pa', 'desc', 1, '50', ['af-attack', 'tf-support']);
  const data = { key: resourceKey('saveA', oldQuery), value: { roleScores: { 'af-attack': 80 } } };
  assert.equal(currentValue(data, resourceKey('saveA', newQuery)), null);
  assert.equal(currentValue(data, resourceKey('saveB', oldQuery)), null);
});
