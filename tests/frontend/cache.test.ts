import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { CacheLifecycle, cacheSize, watchCacheRevision } from '../../web/lib/cache.ts';
import { PlayerPageCache } from '../../web/lib/player-page-cache.ts';
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
