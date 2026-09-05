import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import type { RoleCatalog } from '../../web/lib/scout-api.ts';
import { formatBestRole, formatRoleScore, playerQuery, rankedRoles, roleAbbreviation, roleLabel, selectRole } from '../../web/lib/role-ratings.ts';
import { currentValue, requestSnapshot, resourceKey } from '../../web/lib/snapshot-request.ts';

const catalog = JSON.parse(readFileSync(new URL('../../native/roles.json', import.meta.url), 'utf8')) as RoleCatalog;

test('best role formatting uses one decimal and a short role code without duty', () => {
  for (const [id, code] of [
    ['af-attack', 'AF'], ['ap-support', 'AP'], ['cd-defend', 'CD'], ['anchor-defend', 'A'], ['f9-support', 'F9'],
    ['wtf-support', 'WT'], ['wtf-attack', 'WT'], ['reg-support', 'RGA'],
    ['sv-support', 'VOL'], ['sv-attack', 'VOL'], ['eng-support', 'EG'],
    ['lib-defend', 'L'], ['lib-support', 'L'],
  ]) {
    const role = catalog.roles.find(role => role.id === id)!;
    assert.equal(roleAbbreviation(role), code);
    assert.equal(formatBestRole(85.44, role), `85.4 (${code})`);
    assert.equal(formatBestRole(85, role), `85.0 (${code})`);
    assert.equal(formatBestRole(null, role), '—');
    assert.equal(formatBestRole(85.44, { ...role, id: 'custom-profile', name: 'Renamed role' }), `85.4 (${code})`);
  }
  assert.equal(formatBestRole(85.4, undefined), '—');
});

test('best role requests remain independent of filtered and displayed roles and reject stale responses', () => {
  const filters = { role: 'ap-support', roleMin: '70', position: '12' };
  const plain = playerQuery(filters, 'pa', 'desc', 2, '50', ['af-attack']);
  const best = playerQuery(filters, 'bestRoleRating', 'desc', 2, '50', ['af-attack'], true);
  const params = new URLSearchParams(best);
  assert.equal(params.get('bestRole'), '1');
  assert.equal(params.get('role'), 'ap-support');
  assert.equal(params.get('roles'), 'af-attack');
  assert.equal(params.get('sort'), 'bestRoleRating');
  assert.equal(new URLSearchParams(plain).has('bestRole'), false);
  assert.equal(currentValue({ key: resourceKey('saveA', plain), value: [] }, resourceKey('saveA', best)), null);
});

test('bundled catalog and research documentation reproduce the archived matrix', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/role-catalog.mjs', import.meta.url)), '--check'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('selecting and clearing roles preserves unrelated filters and resets role sorting', () => {
  const filters = { q: 'Ali', club: '42', position: '12', role: '', roleMin: '' };
  const selected = selectRole(filters, 'name', 'asc', 'af-attack');
  assert.deepEqual(selected, { filters: { ...filters, role: 'af-attack' }, sort: 'roleRating', direction: 'desc', page: 1 });
  const switched = selectRole({ ...selected.filters, roleMin: '75.5' }, 'roleRating', 'asc', 'bpd-defend');
  assert.equal(switched.filters.roleMin, '75.5');
  assert.equal(switched.filters.position, '12');
  const cleared = selectRole(switched.filters, switched.sort, switched.direction, '');
  assert.equal(cleared.filters.roleMin, '');
  assert.equal(cleared.sort, 'pa');
  assert.equal(cleared.direction, 'desc');
  assert.equal(selectRole(switched.filters, 'name', 'asc', '').sort, 'name');
  const query = new URLSearchParams(playerQuery(switched.filters, switched.sort, switched.direction, 1, '50'));
  assert.equal(query.get('role'), 'bpd-defend');
  assert.equal(query.get('roleMin'), '75.5');
  assert.equal(query.get('position'), '12');
});

test('profile ranks all duties using full precision, keeps null last and supports selected role', () => {
  const ratings = catalog.roles.map((role, i) => ({ roleId: role.id, score: i % 3 ? 75.01 + i / 10000 : null, missingAttributes: [] }));
  const ranked = rankedRoles(catalog.roles, ratings, '');
  assert.equal(ranked.length, 85);
  assert.ok(ranked[0].rating!.score! > ranked[1].rating!.score!);
  assert.equal(ranked.at(-1)!.rating!.score, null);
  const selected = catalog.roles.find(role => role.id === 'if-attack')!;
  const filtered = rankedRoles(catalog.roles, ratings, roleLabel(selected));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].role.id, 'if-attack');
  assert.equal(rankedRoles(catalog.roles, ratings, 'no such role').length, 0);
  assert.equal(formatRoleScore(78.54), '78.5');
  assert.equal(formatRoleScore(null), '—');
});

test('old data is hidden immediately when player, role query or save identity changes', () => {
  const cached = { key: resourceKey('saveA', 7), value: { score: 85 } };
  assert.equal(currentValue(cached, resourceKey('saveB', 7)), null);
  assert.equal(currentValue(cached, resourceKey('saveA', 8)), null);
  assert.deepEqual(currentValue(cached, resourceKey('saveA', 7)), { score: 85 });
  const search = { key: resourceKey('saveA', 'role=af-attack'), value: [85] };
  assert.equal(currentValue(search, resourceKey('saveA', 'role=bpd-defend')), null);
});

for (const outcome of ['resolve', 'reject'] as const) {
  test(`cancelled ${outcome} cannot overwrite new ratings even if transport ignores abort`, async () => {
    const pending: { resolve: (v: string) => void; reject: (e: Error) => void; signal: AbortSignal }[] = [];
    const seen: string[] = [];
    const request = (_path: string, init: RequestInit) => new Promise<string>((resolve, reject) => pending.push({ resolve, reject, signal: init.signal! }));
    const callbacks = { request, onValue: (value: string) => seen.push(value), onError: () => seen.push('error'), onSettled: () => seen.push('settled') };
    const stop = requestSnapshot({ ...callbacks, path: 'saveA/player1' });
    stop();
    assert.equal(pending[0].signal.aborted, true);
    const stopNew = requestSnapshot({ ...callbacks, path: 'saveB/player2' });
    pending[1].resolve('new rating');
    await setImmediate();
    if (outcome === 'resolve') pending[0].resolve('old rating');
    else pending[0].reject(new Error('old failure'));
    await setImmediate();
    assert.deepEqual(seen, ['new rating', 'settled']);
    stopNew();
  });
}

test('cancelled debounced role search never issues a request', async () => {
  let requests = 0;
  const stop = requestSnapshot({ path: 'role=af-attack', delay: 10, request: async () => { requests++; }, onValue: () => {}, onError: () => {} });
  stop();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requests, 0);
});

test('debounced role search runs once after the delay and delivers its result before settling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const paths: string[] = [];
  const seen: string[] = [];
  const stop = requestSnapshot({
    path: 'role=af-attack', delay: 200,
    request: async path => { paths.push(path); return 'rating'; },
    onValue: value => seen.push(value),
    onError: () => seen.push('error'),
    onSettled: () => seen.push('settled'),
  });
  t.after(stop);
  t.mock.timers.tick(199);
  assert.deepEqual(paths, []);
  assert.deepEqual(seen, []);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.deepEqual(paths, ['role=af-attack']);
  assert.deepEqual(seen, ['rating', 'settled']);
  t.mock.timers.tick(1000);
  assert.equal(paths.length, 1);
});
