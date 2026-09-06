import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { CacheLifecycle, cacheSize, handleSnapshotError, watchCacheRevision } from '../../web/lib/cache.ts';
import { PlayerPageCache } from '../../web/lib/player-page-cache.ts';
import { requestSnapshot } from '../../web/lib/snapshot-request.ts';
import { ApiError } from '../../web/lib/scout-api.ts';
import type { Results } from '../../web/lib/scout-api.ts';

test('cache size distinguishes zero, small values, unavailable readings and MB/GB', () => {
  for (const [bytes, expected] of [[null, 'Unavailable'], [0, '0 MB'], [1, '<0.1 MB'], [99_999, '<0.1 MB'], [100_000, '0.1 MB'], [136_270_000, '136.3 MB'], [1e9, '1.0 GB'], [2.45e9, '2.5 GB']] as const) {
    assert.equal(cacheSize(bytes), expected);
  }
});

test('serialized browser cache bytes track paired pages, replacement, eviction and clear', async () => {
  const identity = { systemId: 'test', systemRevision: 1 };
  const cache = new PlayerPageCache('save', identity);
  const result: Results = { ...identity, total: 0, page: 1, limit: 50, players: [] };
  const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
  assert.equal(cache.estimatedBytes(), 0);
  await cache.load('page=1', async () => ({ ...result, reversePage: result }));
  assert.equal(cache.estimatedBytes(), bytes * 2);
  await cache.load('page=1', async () => result);
  assert.equal(cache.estimatedBytes(), bytes * 2);
  for (let i = 2; i < 90; i++) await cache.load(`page=${i}`, async () => result);
  assert.equal(cache.estimatedBytes(), bytes * 64);
  cache.clear();
  assert.equal(cache.estimatedBytes(), 0);
});

test('revision invalidation aborts transport and rejects late responses even if transport ignores abort', async () => {
  const lifecycle = new CacheLifecycle();
  assert.equal(lifecycle.observe('first'), false);
  let finish!: (result: unknown) => void;
  let signal!: AbortSignal;
  const request = lifecycle.request('/snapshots/save/players?sort=ca', {}, async <T>(path: string, init: RequestInit = {}) => {
    assert.match(path, /&cacheRevision=first$/);
    signal = init.signal as AbortSignal;
    return new Promise<T>(resolve => { finish = value => resolve(value as T); });
  });
  assert.equal(lifecycle.observe('first'), false);
  assert.equal(signal.aborted, false);
  assert.equal(lifecycle.observe('second'), true);
  assert.equal(signal.aborted, true);
  finish({ old: true });
  await assert.rejects(request, { name: 'AbortError' });
  const next = await lifecycle.request('/imports', {}, async <T>(path: string) => {
    assert.equal(path, '/imports?cacheRevision=second');
    return 'current' as T;
  });
  assert.equal(next, 'current');
});

test('revision watcher skips hidden windows and ignores replaced and disposed refreshes', async () => {
  const target = new EventTarget();
  const visibility = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
  const pending: ((value: { cacheRevision: string }) => void)[] = [];
  const revisions: string[] = [];
  const dispose = watchCacheRevision({ target, visibility,
    request: async <T>() => new Promise<T>(resolve => pending.push(value => resolve(value as T))),
    onRevision: value => revisions.push(value),
  });
  assert.equal(pending.length, 0);
  visibility.visibilityState = 'visible';
  visibility.dispatchEvent(new Event('visibilitychange'));
  target.dispatchEvent(new Event('focus'));
  pending[0]({ cacheRevision: 'old' });
  pending[1]({ cacheRevision: 'new' });
  await setImmediate();
  assert.deepEqual(revisions, ['new']);
  target.dispatchEvent(new Event('focus'));
  dispose();
  pending[2]({ cacheRevision: 'disposed' });
  await setImmediate();
  assert.deepEqual(revisions, ['new']);
});

for (const resource of ['search', 'detail'] as const) {
  test(`${resource} cache conflict immediately reconciles the revision without refreshing roles or retrying the snapshot`, async t => {
    const lifecycle = new CacheLifecycle();
    lifecycle.observe('old');
    const identity = { systemId: 'test', systemRevision: 1 };
    const cache = new PlayerPageCache('save', identity);
    const page: Results = { ...identity, total: 0, page: 1, limit: 50, players: [] };
    await cache.load('page=1', async () => page);
    const calls: string[] = [];
    const errors: unknown[] = [];
    let unloads = 0;
    const request = <T>(path: string, init: RequestInit = {}) => lifecycle.request<T>(path, init, async <V>(url: string) => {
      calls.push(url);
      if (url === '/settings') return { cacheRevision: 'new' } as V;
      throw new ApiError('Cache cleared', 409, 'CACHE_CHANGED');
    });
    const stop = requestSnapshot({
      path: resource === 'search' ? 'page=2' : '/snapshots/save/players/1',
      request: resource === 'search' ? (path, init) => cache.load(path, (url, options) => request<Results>(url, { ...options, signal: init.signal })) : request,
      onValue: () => assert.fail('A cleared snapshot must not return data'),
      onError: error => { void handleSnapshotError(error, {
        request,
        onRevision: revision => { if (lifecycle.observe(revision)) { cache.clear(); unloads++; } },
        refreshRoles: async () => assert.fail('Cache changes must not refresh roles'),
        onError: error => errors.push(error),
      }); },
    });
    t.after(stop);
    await setImmediate();
    assert.equal(calls.length, 2);
    assert.match(calls[0], /cacheRevision=old$/);
    assert.equal(calls[1], '/settings');
    assert.equal(lifecycle.revision, 'new');
    assert.equal(unloads, 1);
    assert.equal(cache.estimatedBytes(), 0);
    assert.deepEqual(errors, []);
  });
}

test('ordinary conflicts refresh roles and ordinary failures retain their original errors', async () => {
  const errors: unknown[] = [];
  let roleRefreshes = 0;
  const options = {
    request: async <T>(): Promise<T> => assert.fail('Only cache changes request settings'),
    onRevision: () => assert.fail('Only cache changes observe revisions'),
    refreshRoles: async () => { roleRefreshes++; },
    onError: (error: unknown) => errors.push(error),
  };
  await handleSnapshotError(new ApiError('Rating system changed', 409), options);
  assert.equal(roleRefreshes, 1);
  assert.deepEqual(errors, []);
  const failures = [new ApiError('Invalid query', 400), new Error('Offline'), 'Unknown failure'];
  for (const failure of failures) await handleSnapshotError(failure, options);
  assert.deepEqual(errors, failures);
  assert.equal(roleRefreshes, 1);
});

test('recovery failures reach the originating error callback and all cancellation errors stay quiet', async () => {
  const aborted = new DOMException('Cancelled', 'AbortError');
  for (const resource of ['search', 'detail'] as const) {
    for (const conflict of [new ApiError('Cache cleared', 409, 'CACHE_CHANGED'), new ApiError('Rating system changed', 409)]) {
      const errors: Record<string, unknown[]> = { search: [], detail: [] };
      let failure: Error = new Error('Recovery unavailable');
      const options = {
        request: async <T>(): Promise<T> => { throw failure; },
        onRevision: () => assert.fail('A failed read must not change the revision'),
        refreshRoles: async () => { throw failure; },
        onError: (error: unknown) => errors[resource].push(error),
      };
      await handleSnapshotError(conflict, options);
      assert.deepEqual(errors[resource], [failure]);
      assert.deepEqual(errors[resource === 'search' ? 'detail' : 'search'], []);
      errors[resource] = [];
      failure = aborted;
      await handleSnapshotError(conflict, options);
      await handleSnapshotError(aborted, {
        ...options,
        request: async <T>(): Promise<T> => assert.fail('An aborted request needs no recovery'),
        refreshRoles: async () => assert.fail('An aborted request needs no recovery'),
      });
      assert.deepEqual(errors[resource], []);
    }
  }
});

test('concurrent recovery invalidates once and late settings and player responses cannot restore stale state', async () => {
  const lifecycle = new CacheLifecycle();
  lifecycle.observe('old');
  const pending: { path: string; signal: AbortSignal; resolve: (value: unknown) => void }[] = [];
  const request = <T>(path: string, init: RequestInit = {}) => lifecycle.request<T>(path, init, <V>(url: string, options: RequestInit = {}) =>
    new Promise<V>(resolve => pending.push({ path: url, signal: options.signal!, resolve: value => resolve(value as V) })));
  const errors: unknown[] = [];
  const revisions: string[] = [];
  let unloads = 0;
  const options = {
    request,
    onRevision: (revision: string) => {
      revisions.push(revision);
      if (lifecycle.observe(revision)) { lifecycle.cancel(); unloads++; }
    },
    refreshRoles: async () => assert.fail('Cache changes must not refresh roles'),
    onError: (error: unknown) => errors.push(error),
  };
  const latePlayer = request('/snapshots/save/players/1')
    .then(() => assert.fail('Late player data must not reach the view'))
    .catch(error => handleSnapshotError(error, options));
  const conflict = new ApiError('Cache cleared', 409, 'CACHE_CHANGED');
  const first = handleSnapshotError(conflict, options);
  const second = handleSnapshotError(conflict, options);
  assert.deepEqual(pending.map(item => item.path), ['/snapshots/save/players/1?cacheRevision=old', '/settings', '/settings']);
  pending[1].resolve({ cacheRevision: 'new' });
  await first;
  assert.ok(pending.every(item => item.signal.aborted));
  // The transport deliberately ignores abort and returns obsolete data.
  pending[2].resolve({ cacheRevision: 'old' });
  pending[0].resolve({ name: 'Stale player' });
  await Promise.all([second, latePlayer]);
  assert.equal(lifecycle.revision, 'new');
  assert.equal(unloads, 1);
  assert.deepEqual(revisions, ['new']);
  assert.deepEqual(errors, []);
});
