import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { activeFilterCount, defaultPositionFilters, selectedPositions, selectPositions } from '../../web/lib/position-filter.ts';
import { playerQuery } from '../../web/lib/role-ratings.ts';
import { currentValue, resourceKey, requestSnapshot } from '../../web/lib/snapshot-request.ts';

test('positions default to AND and do not activate a filter until a position is selected', () => {
  assert.deepEqual(defaultPositionFilters, { position: '', positionMatch: 'and' });
  assert.equal(activeFilterCount(defaultPositionFilters), 0);
  assert.equal(activeFilterCount({ position: '', positionMatch: 'or' }), 0);
  const selected = selectPositions(defaultPositionFilters, ['4', '2', '4', '0']);
  assert.deepEqual(selectedPositions(selected.filters.position), ['0', '2', '4']);
  assert.equal(selected.filters.positionMatch, 'and');
  assert.equal(activeFilterCount(selected.filters), 1);
  assert.equal(selected.page, 1);
});

test('mode changes, chip removal and clearing reset the page and preserve unrelated filters', () => {
  const filters = { q: 'Ali', club: '1', attr_pace: '16', role: 'cd-defend', roleMin: '70', position: '2,4', positionMatch: 'and' };
  const or = selectPositions(filters, ['2', '4'], 'or');
  assert.deepEqual(or, { filters: { ...filters, positionMatch: 'or' }, page: 1 });
  const removed = selectPositions(or.filters, ['4']);
  assert.equal(removed.page, 1);
  assert.equal(removed.filters.positionMatch, 'or');
  for (const from of [or.filters, removed.filters]) {
    const cleared = selectPositions(from, []);
    assert.deepEqual(cleared, { filters: { ...filters, ...defaultPositionFilters }, page: 1 });
    assert.deepEqual(selectedPositions(cleared.filters.position), []);
  }
});

test('query serialization includes matching only with positions and preserves sort, columns and other filters', () => {
  const filters = { ...defaultPositionFilters, club: '1', attr_pace: '16' };
  const params = (f: Record<string, string>) => new URLSearchParams(playerQuery(f, 'role:cd-defend', 'asc', 1, '50', ['cd-defend', 'af-attack']));
  assert.equal(params(filters).has('position'), false);
  assert.equal(params(filters).has('positionMatch'), false);
  const multi = params(selectPositions(filters, ['4', '2'], 'or').filters);
  assert.equal(multi.get('position'), '2,4');
  assert.equal(multi.get('positionMatch'), 'or');
  assert.equal(multi.get('sort'), 'role:cd-defend');
  assert.equal(multi.get('direction'), 'asc');
  assert.equal(multi.get('roles'), 'cd-defend,af-attack');
  assert.equal(multi.get('club'), '1');
  assert.equal(multi.get('attr_pace'), '16');
  assert.equal(params({ position: '12' }).get('positionMatch'), 'and');
});

test('changing the matching rule hides and rejects an old response even if transport ignores abort', async () => {
  const and = selectPositions(defaultPositionFilters, ['2', '4']);
  const or = selectPositions(and.filters, ['2', '4'], 'or');
  const path = (filters: Record<string, string>) => playerQuery(filters, 'pa', 'desc', 1, '50');
  const oldKey = resourceKey('saveA', path(and.filters));
  const newKey = resourceKey('saveA', path(or.filters));
  assert.notEqual(oldKey, newKey);
  assert.equal(currentValue({ key: oldKey, value: [1] }, newKey), null);
  const pending: ((ids: number[]) => void)[] = [];
  const seen: number[][] = [];
  const callbacks = {
    request: () => new Promise<number[]>(resolve => pending.push(resolve)),
    onValue: (ids: number[]) => seen.push(ids), onError: (error: unknown) => { throw error; },
  };
  const cancelOld = requestSnapshot({ ...callbacks, path: path(and.filters) });
  cancelOld();
  const cancelNew = requestSnapshot({ ...callbacks, path: path(or.filters) });
  pending[1]([1, 2, 3]);
  await setImmediate();
  pending[0]([1]);
  await setImmediate();
  assert.deepEqual(seen, [[1, 2, 3]]);
  cancelNew();
});
