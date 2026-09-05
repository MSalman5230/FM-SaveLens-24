import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import type { Attribute, RoleCatalog, RatingSystem, RatingSystems } from '../../web/lib/scout-api.ts';
import { builtinSystemId, hybridSystemId, editRole, parseWeights, ratingCapacity, ratingIdentity, ratingModel, ratingModelNote, ratingParams, ratingSystemLabel, reconcileRatingView, roleWeights, sameRatingSystem, weightAttributes, weightDraft } from '../../web/lib/rating-systems.ts';
import { currentValue, requestSnapshot, resourceKey } from '../../web/lib/snapshot-request.ts';

const catalog = { ...JSON.parse(readFileSync(new URL('../../native/roles.json', import.meta.url), 'utf8')), systemId: builtinSystemId, systemName: 'Role Highlighted Rating', systemRevision: 1, builtIn: true } as RoleCatalog;
const attributes = JSON.parse(readFileSync(new URL('../../native/parser/attributes.json', import.meta.url), 'utf8')).attributes as Attribute[];
const system: RatingSystem = { id: 'test-system', name: 'Custom', revision: 1, builtIn: false, roles: catalog.roles };

test('capacity excludes presets, permits edits at the limit, and blocks additions during recovery', () => {
  const library: RatingSystems = {
    activeSystemId: system.id, catalog, limits: { maxCustomSystems: 32, maxRolesPerSystem: 128 },
    systems: [
      ...[builtinSystemId, hybridSystemId].map(id => ({ ...system, id, builtIn: true, roleCount: 85 })),
      ...Array.from({ length: 31 }, (_, i) => ({ ...system, id: String(i), roleCount: 85 })),
    ],
  };
  assert.deepEqual(ratingCapacity(library, system), { canAddSystem: true, canAddRole: true });
  library.systems.push({ ...system, roleCount: 85 });
  const full = { ...system, roles: Array.from({ length: 128 }, () => system.roles[0]) };
  assert.deepEqual(ratingCapacity(library, full), { canAddSystem: false, canAddRole: false });
  assert.equal(ratingCapacity(library, { ...full, roles: full.roles.slice(0, 127) }).canAddRole, true);
  assert.equal(ratingCapacity(library, { ...system, builtIn: true }).canAddRole, false);
  library.recovery = { message: 'Unsupported file version' };
  library.systems = [];
  assert.deepEqual(ratingCapacity(library, system), { canAddSystem: false, canAddRole: false });
  assert.deepEqual(ratingCapacity(null, null), { canAddSystem: false, canAddRole: false });
});

test('hybrid presentation uses system identity and distinguishes legacy name collisions', () => {
  assert.equal(ratingModel(builtinSystemId), 'highlighted');
  assert.equal(ratingModel(hybridSystemId), 'hybrid');
  assert.equal(ratingModel('custom-copy'), 'custom');
  assert.match(ratingModelNote(hybridSystemId), /70%.*30%/);
  assert.match(ratingModelNote(hybridSystemId), /×1\.5.*×1\.25/);
  assert.match(ratingModelNote(builtinSystemId), /twice/);
  assert.match(ratingModelNote('custom-copy'), /saved attribute weights/);
  assert.notEqual(ratingSystemLabel({ name: 'FM-Arena Hybrid Rating', builtIn: true }),
    ratingSystemLabel({ name: 'FM-Arena Hybrid Rating', builtIn: false }));
});

test('switching to hybrid retains role filters and columns but invalidates old results', () => {
  const hybrid = { ...catalog, systemId: hybridSystemId, systemName: 'FM-Arena Hybrid Rating', modelVersion: 'fm-arena-hybrid-v1' };
  const filters = { role: 'cd-defend', roleMin: '70', q: 'Ali' };
  const view = reconcileRatingView(hybrid, filters, ['name', 'role:cd-defend', 'role:gk-defend'], 'role:cd-defend', 'desc');
  assert.deepEqual(view.filters, filters);
  assert.deepEqual(view.columnIds, ['name', 'role:cd-defend', 'role:gk-defend']);
  assert.equal(view.sort, 'role:cd-defend');
  assert.equal(sameRatingSystem(catalog, hybrid), false);
  const cached = { key: resourceKey('save', ratingIdentity(catalog)), value: { score: 75 } };
  assert.equal(currentValue(cached, resourceKey('save', ratingIdentity(hybrid))), null);
  assert.equal(new URLSearchParams(ratingParams(hybrid)).get('systemId'), hybridSystemId);
});

test('editable attributes include both feet and only Consistency from hidden attributes', () => {
  const keys = weightAttributes(attributes).map(attribute => attribute.key);
  assert.equal(keys.length, 50);
  for (const key of ['finishing', 'pace', 'vision', 'reflexes', 'leftFoot', 'rightFoot', 'consistency']) assert.ok(keys.includes(key));
  for (const attribute of attributes.filter(attribute => attribute.group === 'Hidden' && attribute.key !== 'consistency')) assert.ok(!keys.includes(attribute.key));
});

test('weight drafts preserve decimals and reject invalid or empty calculations', () => {
  assert.deepEqual(parseWeights({ finishing: '1.25', leftFoot: '0.5', rightFoot: '2', consistency: '1', pace: '0' }, attributes),
    { finishing: 1.25, leftFoot: 0.5, rightFoot: 2, consistency: 1 });
  for (const weights of [{}, { pace: '0' }, { pace: '' }, { pace: '-1' }, { pace: 'Infinity' }, { pace: 'NaN' }, { injuryProneness: '0' }])
    assert.throws(() => parseWeights(weights, attributes));
  const original = catalog.roles.find(role => role.id === 'af-attack')!;
  assert.equal(roleWeights(original).finishing, 2);
  assert.deepEqual(parseWeights(weightDraft(original), attributes), roleWeights(original));
});

test('saving as a new role keeps its source unchanged and inherits duty and group', () => {
  const original = system.roles.find(role => role.id === 'af-attack')!;
  const before = JSON.stringify(system);
  const roles = editRole(system, original.id, ' My forward ', { finishing: 2.5, consistency: 1 }, 'custom-new-id');
  assert.equal(roles.length, 86);
  assert.equal(JSON.stringify(system), before);
  assert.deepEqual(roles.find(role => role.id === original.id), original);
  assert.deepEqual(roles.at(-1), { ...original, id: 'custom-new-id', name: 'My forward', weights: { finishing: 2.5, consistency: 1 } });
  assert.throws(() => editRole(system, original.id, original.name.toUpperCase(), { pace: 1 }, 'custom-new-id'));
  assert.throws(() => editRole(system, original.id, ' ', { pace: 1 }));
  const updated = editRole(system, original.id, 'Edited forward', { pace: 1 });
  assert.equal(updated.length, 85); assert.equal(updated.find(role => role.id === original.id)!.name, 'Edited forward');
});

test('switching systems preserves compatible filters, clears removed roles, and repairs columns and sorting', () => {
  const filters = { role: 'custom-removed', roleMin: '72.5', q: 'Ali', club: '42', position: '2,4', positionMatch: 'or' };
  const next = reconcileRatingView(catalog, filters, ['name', 'pa', 'role:custom-removed', 'role:af-attack'], 'role:custom-removed', 'asc');
  assert.deepEqual(next, { filters: { ...filters, role: '', roleMin: '' }, columnIds: ['name', 'pa', 'role:af-attack'], sort: 'pa', direction: 'desc', page: 1 });
  const valid = reconcileRatingView(catalog, { ...filters, role: 'af-attack' }, ['name', 'role:af-attack'], 'roleRating', 'asc');
  assert.equal(valid.filters.roleMin, '72.5'); assert.equal(valid.sort, 'roleRating'); assert.equal(valid.direction, 'asc');
});

test('system identity scopes results even when the save, player, and role are unchanged', () => {
  const updated = { ...catalog, systemRevision: 2 };
  const key = (value: RoleCatalog) => resourceKey('save', `player-1:${ratingIdentity(value)}`);
  const result = { key: key(catalog), value: 75 };
  assert.equal(currentValue(result, key(updated)), null);
  assert.equal(sameRatingSystem(catalog, updated), false);
  assert.equal(sameRatingSystem({ ...catalog, systemId: 'other' }, catalog), false);
  assert.equal(sameRatingSystem(catalog, catalog), true);
  const query = new URLSearchParams(ratingParams(updated));
  assert.equal(query.get('systemRevision'), '2'); assert.equal(query.get('systemId'), builtinSystemId);
});

test('an old system response cannot overwrite the new system after a change', async () => {
  const pending: ((value: string) => void)[] = []; const seen: string[] = [];
  const request = () => new Promise<string>(resolve => pending.push(resolve));
  const stop = requestSnapshot({ path: '?systemRevision=1', request, onValue: value => seen.push(value), onError: () => {} });
  stop();
  const stopNext = requestSnapshot({ path: '?systemRevision=2', request, onValue: value => seen.push(value), onError: () => {} });
  pending[1]('new weights'); await setImmediate(); pending[0]('old weights'); await setImmediate();
  assert.deepEqual(seen, ['new weights']); stopNext();
});
