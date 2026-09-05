import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { watchSnapshotFocus } from '../../web/lib/focus-refresh.ts';
import type { SaveFile, Snapshot } from '../../web/lib/scout-api.ts';

const snapshot = (id: string, stale = false): Snapshot => ({
  snapshotId: id, name: id, gameDate: '2024-04-09', sourceName: id + '.fm',
  playerCount: 64, stale, warnings: [], clubs: [], nations: [], diagnostics: {},
});
const save = (id: string): SaveFile => ({
  id, name: id + '.fm', size: 1000, modified: '2024-04-09', snapshotId: id, cached: true,
});
type Pending = {
  path: string;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

function workspace(deferUpdates = false) {
  const target = new EventTarget();
  const pending: Pending[] = [];
  const updates: ((current: Snapshot | null) => Snapshot | null)[] = [];
  let current: Snapshot | null = snapshot('A');
  let saves: SaveFile[] = [];
  const dispose = watchSnapshotFocus({
    target,
    snapshotId: 'A',
    request: <T>(path: string, init: RequestInit = {}) => new Promise<T>((resolve, reject) => {
      assert.ok(init.signal);
      // Deliberately ignore cancellation to exercise the late-response guards.
      pending.push({ path, signal: init.signal, resolve: (value) => resolve(value as T), reject });
    }),
    setSnapshot: (update) => {
      if (deferUpdates) updates.push(update);
      else current = update(current);
    },
    setSaves: (value) => { saves = value; },
  });
  return {
    pending, updates, dispose,
    focus: () => target.dispatchEvent(new Event('focus')),
    get current() { return current; },
    set current(value: Snapshot | null) { current = value; },
    get saves() { return saves; },
  };
}

test('focus refresh updates metadata and the save list with a shared cancellation signal', async (t) => {
  const app = workspace(); t.after(app.dispose);
  app.focus();
  assert.deepEqual(app.pending.map((p) => p.path), ['/snapshots/A', '/saves']);
  assert.equal(app.pending[0].signal, app.pending[1].signal);
  const updated = snapshot('A', true);
  app.pending[0].resolve(updated);
  app.pending[1].resolve({ saves: [save('A')] });
  await setImmediate();
  assert.equal(app.current, updated);
  assert.deepEqual(app.saves, [save('A')]);
});

for (const next of [snapshot('B'), null]) {
  test(`save A cannot overwrite ${next ? 'save B' : 'a cleared workspace'} before effect cleanup`, async (t) => {
    const app = workspace(); t.after(app.dispose);
    app.focus();
    app.current = next;
    app.pending[0].resolve(snapshot('A', true));
    app.pending[1].resolve({ saves: [] });
    await setImmediate();
    assert.equal(app.current, next);
  });
}

test('a new focus aborts both previous requests and ignores their late responses', async (t) => {
  const app = workspace(); t.after(app.dispose);
  app.focus(); app.focus();
  assert.ok(app.pending[0].signal.aborted);
  assert.ok(app.pending[1].signal.aborted);
  assert.equal(app.pending[2].signal.aborted, false);
  const newest = snapshot('A', true);
  app.pending[2].resolve(newest);
  app.pending[3].resolve({ saves: [save('new')] });
  await setImmediate();
  app.pending[0].resolve(snapshot('A'));
  app.pending[1].resolve({ saves: [save('old')] });
  await setImmediate();
  assert.equal(app.current, newest);
  assert.deepEqual(app.saves, [save('new')]);
});

test('cleanup aborts requests, ignores late responses, and removes the focus listener', async () => {
  const app = workspace();
  app.focus(); app.dispose();
  app.current = null;
  assert.ok(app.pending.every((p) => p.signal.aborted));
  app.pending[0].resolve(snapshot('A', true));
  app.pending[1].resolve({ saves: [save('old')] });
  await setImmediate();
  app.focus();
  assert.equal(app.pending.length, 2);
  assert.equal(app.current, null);
  assert.deepEqual(app.saves, []);
});

test('queued React updaters remain safe after cleanup or a save switch', async (t) => {
  const app = workspace(true); t.after(app.dispose);
  app.focus();
  app.pending[0].resolve(snapshot('A', true));
  app.pending[1].resolve({ saves: [] });
  await setImmediate();
  assert.equal(app.updates.length, 1);
  const next = snapshot('B');
  assert.equal(app.updates[0](next), next);
  assert.equal(app.updates[0](null), null);
  const original = app.current;
  app.dispose();
  assert.equal(app.updates[0](original), original);
});

test('background failures stay quiet and do not prevent later refreshes', async (t) => {
  const app = workspace(); t.after(app.dispose);
  const original = app.current;
  app.focus();
  app.pending[0].reject(new Error('Metadata unavailable'));
  app.pending[1].reject(new Error('Save folder unavailable'));
  await setImmediate();
  assert.equal(app.current, original);
  assert.deepEqual(app.saves, []);
  app.focus();
  const updated = snapshot('A', true);
  app.pending[2].resolve(updated);
  app.pending[3].resolve({ saves: [save('A')] });
  await setImmediate();
  assert.equal(app.current, updated);
  assert.deepEqual(app.saves, [save('A')]);
});

test('metadata and save-list refresh failures are independent', async (t) => {
  const app = workspace(); t.after(app.dispose);
  app.focus();
  app.pending[0].reject(new Error('Metadata unavailable'));
  app.pending[1].resolve({ saves: [save('A')] });
  await setImmediate();
  assert.deepEqual(app.saves, [save('A')]);
  app.focus();
  const updated = snapshot('A', true);
  app.pending[2].resolve(updated);
  app.pending[3].reject(new Error('Save list unavailable'));
  await setImmediate();
  assert.equal(app.current, updated);
  assert.deepEqual(app.saves, [save('A')]);
});
