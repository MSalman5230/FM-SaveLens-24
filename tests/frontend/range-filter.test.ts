import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitRangeBound, playerRanges, rangeValues } from '../../web/lib/range-filter.ts';
import { playerQuery } from '../../web/lib/role-ratings.ts';

test('player sliders use age 0–50 and ability 0–200; unset bounds show the full track', () => {
  assert.deepEqual(playerRanges.map(({ key, max }) => [key, max]), [['age', 50], ['ca', 200], ['pa', 200]]);
  for (const { max } of playerRanges) {
    assert.deepEqual(rangeValues(['', ''], max), [0, max]);
    assert.deepEqual(rangeValues(['0', '0'], max), [0, 0]);
  }
});

test('manual bounds exceed slider limits and preserve the entered value when bounds cross', () => {
  assert.deepEqual(commitRangeBound(['', ''], 1, '99'), ['', '99']);
  assert.deepEqual(commitRangeBound(['', ''], 0, '-1'), ['0', '']);
  assert.deepEqual(commitRangeBound(['', ''], 1, '250'), ['', '250']);
  assert.deepEqual(commitRangeBound(['', ''], 0, '250'), ['250', '']);
  assert.deepEqual(commitRangeBound(['', ''], 0, '18.7'), ['19', '']);
  assert.deepEqual(commitRangeBound(['18', '25'], 0, '30'), ['30', '30']);
  assert.deepEqual(commitRangeBound(['100', '200'], 0, '250'), ['250', '250']);
  assert.deepEqual(commitRangeBound(['100', '180'], 1, '80'), ['80', '80']);
  for (const invalid of ['NaN', 'Infinity', '-Infinity', '9007199254740992']) {
    assert.deepEqual(commitRangeBound(['18', '25'], 0, invalid), ['18', '25']);
  }
});

test('slider presentation caps handles without changing search bounds or the other manual bound', () => {
  assert.deepEqual(rangeValues(['60', '250'], 50), [50, 50]);
  assert.deepEqual(rangeValues(['100', '250'], 200), [100, 200]);
  assert.deepEqual(rangeValues(['250', ''], 200), [200, 200]);
  assert.deepEqual(commitRangeBound(['100', '250'], 0, '120'), ['120', '250']);
  assert.deepEqual(commitRangeBound(['250', '300'], 1, '180'), ['180', '180']);
});

test('manual values beyond every slider maximum are sent unchanged to search', () => {
  for (const { key } of playerRanges) {
    for (const index of [0, 1] as const) {
      const bounds = commitRangeBound(['', ''], index, '250');
      const params = new URLSearchParams(playerQuery({ [key + 'Min']: bounds[0], [key + 'Max']: bounds[1] }, 'pa', 'desc', 1, '50'));
      assert.equal(params.get(key + (index === 0 ? 'Min' : 'Max')), '250');
    }
  }
});

test('clearing a bound removes only that restriction; explicit zero survives query serialization', () => {
  assert.deepEqual(commitRangeBound(['18', '25'], 0, ''), ['', '25']);
  assert.deepEqual(commitRangeBound(['18', '25'], 1, ''), ['18', '']);
  const [ageMin, ageMax] = commitRangeBound(['', '25'], 0, '0');
  const params = new URLSearchParams(playerQuery({ ageMin, ageMax, caMin: '120', caMax: '200', paMin: '', paMax: '', role: 'af-attack' }, 'pa', 'desc', 1, '50'));
  assert.equal(params.get('ageMin'), '0');
  assert.equal(params.get('ageMax'), '25');
  assert.equal(params.get('caMin'), '120');
  assert.equal(params.get('caMax'), '200');
  assert.equal(params.get('role'), 'af-attack');
  assert.equal(params.has('paMin'), false);
  assert.equal(params.has('paMax'), false);
});
