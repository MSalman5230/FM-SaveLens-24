import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import fixture from './fixtures/position-filters.json' with { type: 'json' };
import { ATTRIBUTES, POSITIONS } from '../server/parser/attributes.ts';
import { createSnapshot, searchPlayers, QueryError } from '../server/storage.ts';
import type { ParsedSave } from '../server/parser/index.ts';

test('reference position queries match the shared boundary, validation and pagination fixtures', t => {
  const root = mkdtempSync(join(tmpdir(), 'fm24-positions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'snapshot.sqlite');
  const save: ParsedSave = {
    name: 'Position fixture', formatVersion: '24.3.0+0', gameDate: '2024-01-01',
    clubs: [], diagnostics: {}, warnings: [],
    players: fixture.players.map(row => {
      const positionRatings = POSITIONS.map((_, i) => (row.ratings as Record<string, number>)[i] ?? 0);
      return {
        id: row.id, uid: row.id, name: row.name, fullName: row.name, age: 24,
        birthDate: '2000-01-01', nationId: 1, otherNationIds: [],
        clubId: row.clubId, club: row.clubId == null ? null : `Club ${row.clubId}`,
        ca: 100 + row.id, pa: 150, positionRatings,
        positions: POSITIONS.filter((_, i) => positionRatings[i] >= 15),
        attributes: Object.fromEntries(ATTRIBUTES.map(a => [a.key, row.attribute])),
        rawAttributes: [], source: { person: 0, ability: 0, identity: 0 },
      };
    }),
  };
  createSnapshot(path, save, {});
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    for (const sample of fixture.cases) {
      const result = searchPlayers(db, new URLSearchParams(`${sample.query}&sort=ca&direction=asc`));
      assert.equal(result.total, sample.total, sample.query);
      assert.deepEqual(result.players.map(p => p.id), sample.ids, sample.query);
    }
    for (const query of fixture.invalid)
      assert.throws(() => searchPlayers(db, new URLSearchParams(query)), QueryError, query);
    const descending = searchPlayers(db, new URLSearchParams('position=2,4&positionMatch=or&sort=ca&direction=desc&limit=2&page=2'));
    assert.equal(descending.total, 5);
    assert.deepEqual(descending.players.map(p => p.id), [3, 2]);
    assert.equal(searchPlayers(db, new URLSearchParams()).total, fixture.players.length);
    for (const field of ['age', 'ca', 'pa']) {
      assert.equal(searchPlayers(db, new URLSearchParams(`${field}Min=250`)).total, 0);
      assert.equal(searchPlayers(db, new URLSearchParams(`${field}Max=250`)).total, fixture.players.length);
      for (const invalid of ['-1', '1.5', '9007199254740992']) {
        assert.throws(() => searchPlayers(db, new URLSearchParams(`${field}Min=${invalid}`)), QueryError);
      }
    }
  } finally {
    db.close();
  }
});
