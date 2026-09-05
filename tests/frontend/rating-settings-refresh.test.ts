import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { reconcileRatingEditor, watchRatingSettingsFocus } from '../../web/lib/rating-settings-refresh.ts';
import type { RatingEditor, RatingSettingsRefresh } from '../../web/lib/rating-settings-refresh.ts';
import type { RatingSystem, RatingSystems } from '../../web/lib/scout-api.ts';

const system = (id: string, revision = 1): RatingSystem => ({ id, revision, name: id, builtIn: false, roles: [] });
const a = system('A'), b = system('B');
const library = (active = a, systems = [active, b]): RatingSystems => ({
  limits: { maxCustomSystems: 32, maxRolesPerSystem: 128 },
  activeSystemId: active.id,
  systems: systems.map(({ roles, ...summary }) => ({ ...summary, roleCount: roles.length })),
  catalog: { systemId: active.id, systemRevision: active.revision, systemName: active.name, builtIn: false,
    roles: [], version: '1', modelVersion: 'attribute-weights-v1', gameVersion: '24', scale: 100, sources: [] },
});

test('reconciliation keeps selection across activation, reloads changed clean definitions and falls back after deletion', () => {
  assert.deepEqual(reconcileRatingEditor(library(b, [a, b]), { system: a, dirty: false }), { loadId: null, conflict: null });
  assert.deepEqual(reconcileRatingEditor(library(system('A', 2)), { system: a, dirty: false }), { loadId: 'A', conflict: null });
  assert.deepEqual(reconcileRatingEditor(library(b, [b]), { system: a, dirty: false }), { loadId: 'B', conflict: null });
});

test('dirty revisions remain unchanged until an explicit discard, including a deleted source', () => {
  const editor = { system: a, dirty: true };
  assert.deepEqual(reconcileRatingEditor(library(b, [a, b]), editor), { loadId: null, conflict: null });
  for (const [next, conflict, loadId] of [
    [library(system('A', 2)), 'changed', 'A'], [library(b, [b]), 'deleted', 'B'],
  ] as const) {
    assert.deepEqual(reconcileRatingEditor(next, editor), { loadId: null, conflict });
    assert.deepEqual(reconcileRatingEditor(next, editor, true), { loadId, conflict: null });
    assert.equal(editor.system.revision, 1);
  }
});

type Pending = { path: string; signal: AbortSignal; resolve: (value: unknown) => void; reject: (error: Error) => void };
function workspace() {
  const target = new EventTarget();
  const pending: Pending[] = [], values: RatingSettingsRefresh[] = [], errors: unknown[] = [];
  let editor: RatingEditor = { system: null, dirty: false }, loading = false;
  const watcher = watchRatingSettingsFocus({
    target,
    request: <T>(path: string, init: RequestInit = {}) => new Promise<T>((resolve, reject) => {
      // Intentionally ignore abort to verify late responses cannot update the editor.
      pending.push({ path, signal: init.signal!, resolve: value => resolve(value as T), reject });
    }),
    getEditor: () => editor,
    onValue: value => { values.push(value); if (value.system) editor = { system: value.system, dirty: false }; },
    onError: error => errors.push(error),
    onLoading: value => { loading = value; },
  });
  return { watcher, pending, values, errors, focus: () => target.dispatchEvent(new Event('focus')),
    get editor() { return editor; }, set editor(value: RatingEditor) { editor = value; },
    get loading() { return loading; },
    async open() {
      const opened = watcher.refresh();
      pending.at(-1)!.resolve(library()); await setImmediate();
      assert.equal(pending.at(-1)!.path, '/rating-systems/A');
      pending.at(-1)!.resolve(a); await opened;
    },
  };
}

test('focus publishes activation without replacing the selected editor or its draft', async t => {
  const app = workspace(); t.after(() => app.watcher.dispose()); await app.open();
  app.editor = { system: a, dirty: true };
  app.focus(); app.pending.at(-1)!.resolve(library(b, [a, b])); await setImmediate();
  assert.equal(app.values.at(-1)!.library.activeSystemId, 'B');
  assert.equal(app.values.at(-1)!.system, null);
  assert.deepEqual(app.editor, { system: a, dirty: true });
  assert.equal(app.pending.length, 3);
  assert.equal(app.loading, false);
});

test('focus reloads a clean revision and explicit discard replaces a changed or deleted dirty draft', async t => {
  const app = workspace(); t.after(() => app.watcher.dispose()); await app.open();
  const revised = system('A', 2);
  app.focus(); app.pending.at(-1)!.resolve(library(revised)); await setImmediate();
  assert.equal(app.pending.at(-1)!.path, '/rating-systems/A');
  app.pending.at(-1)!.resolve(revised); await setImmediate();
  assert.equal(app.editor.system, revised);
  for (const [next, replacement, conflict] of [
    [library(system('A', 3)), system('A', 3), 'changed'], [library(b, [b]), b, 'deleted'],
  ] as const) {
    app.editor = { system: revised, dirty: true };
    app.focus(); app.pending.at(-1)!.resolve(next); await setImmediate();
    assert.equal(app.values.at(-1)!.conflict, conflict);
    assert.equal(app.editor.system, revised);
    const discarded = app.watcher.refresh(true);
    app.pending.at(-1)!.resolve(next); await setImmediate();
    app.pending.at(-1)!.resolve(replacement); await discarded;
    assert.deepEqual(app.editor, { system: replacement, dirty: false });
    assert.equal(app.values.at(-1)!.conflict, null);
  }
});

test('superseded reads and selection invalidation reject late definitions', async t => {
  const app = workspace(); t.after(() => app.watcher.dispose()); await app.open();
  app.focus(); const old = app.pending.at(-1)!;
  app.focus(); assert.equal(old.signal.aborted, true);
  app.pending.at(-1)!.resolve(library(b, [a, b])); await setImmediate();
  old.resolve(library()); await setImmediate();
  assert.equal(app.values.at(-1)!.library.activeSystemId, 'B');
  app.focus(); app.pending.at(-1)!.resolve(library(system('A', 2))); await setImmediate();
  const definition = app.pending.at(-1)!;
  app.watcher.invalidate(); app.editor = { system: b, dirty: false };
  definition.resolve(system('A', 2)); await setImmediate();
  assert.equal(definition.signal.aborted, true);
  assert.equal(app.editor.system, b);
  assert.equal(app.loading, false);
});

test('edits made during a definition request preserve their baseline and report a conflict', async t => {
  const app = workspace(); t.after(() => app.watcher.dispose()); await app.open();
  app.focus(); app.pending.at(-1)!.resolve(library(system('A', 2))); await setImmediate();
  app.editor = { system: a, dirty: true };
  app.pending.at(-1)!.resolve(system('A', 2)); await setImmediate();
  assert.equal(app.pending.at(-1)!.path, '/rating-systems');
  app.pending.at(-1)!.resolve(library(system('A', 2))); await setImmediate();
  assert.deepEqual(app.editor, { system: a, dirty: true });
  assert.equal(app.values.at(-1)!.conflict, 'changed');
});

test('mutations abort background reads and coalesce focus events until committed state is available', async t => {
  const app = workspace(); t.after(() => app.watcher.dispose()); await app.open();
  app.focus(); const old = app.pending.at(-1)!;
  app.watcher.pause(); app.focus(); app.focus();
  assert.equal(app.pending.length, 3);
  assert.equal(old.signal.aborted, true);
  const saved = system('A', 2); app.editor = { system: saved, dirty: false };
  old.resolve(library()); await setImmediate();
  assert.equal(app.values.length, 1);
  app.watcher.resume(); assert.equal(app.pending.length, 4);
  app.pending.at(-1)!.resolve(library(saved)); await setImmediate();
  assert.equal(app.editor.system, saved);
  assert.equal(app.values.at(-1)!.library.catalog.systemRevision, 2);
  assert.equal(app.pending.length, 4);
});

test('list and definition failures retain current data and allow retry, including failed discard', async t => {
  const app = workspace(); t.after(() => app.watcher.dispose()); await app.open();
  app.editor = { system: a, dirty: true };
  app.focus(); app.pending.at(-1)!.reject(new Error('offline')); await setImmediate();
  assert.equal(app.values.length, 1); assert.equal(app.errors.length, 1); assert.equal(app.loading, false);
  const discarded = app.watcher.refresh(true);
  app.pending.at(-1)!.resolve(library(system('A', 2))); await setImmediate();
  app.pending.at(-1)!.reject(new Error('definition unavailable')); await discarded;
  assert.deepEqual(app.editor, { system: a, dirty: true });
  assert.equal(app.values.length, 1); assert.equal(app.errors.length, 2); assert.equal(app.loading, false);
  app.focus(); app.pending.at(-1)!.resolve(library(system('A', 2))); await setImmediate();
  assert.equal(app.values.at(-1)!.conflict, 'changed');
});

test('close aborts in-flight work, removes focus listeners, and prevents deferred refreshes', async () => {
  const app = workspace(); await app.open();
  app.focus(); const old = app.pending.at(-1)!;
  app.watcher.pause(); app.focus(); app.watcher.dispose();
  old.resolve(library(b)); app.watcher.resume(); app.focus(); await setImmediate();
  assert.equal(old.signal.aborted, true);
  assert.equal(app.values.length, 1); assert.equal(app.pending.length, 3); assert.equal(app.errors.length, 0);
  assert.equal(await app.watcher.refresh(), null);
});
