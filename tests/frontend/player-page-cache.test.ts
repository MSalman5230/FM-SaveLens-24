import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PlayerPageCache, pageQueryKey, reversePageQuery } from '../../web/lib/player-page-cache.ts';
import { requestSnapshot } from '../../web/lib/snapshot-request.ts';
import type { Results } from '../../web/lib/scout-api.ts';

const identity = { systemId: 'test', systemRevision: 1 };
const query = 'sort=bestRoleRating&direction=desc&page=1&limit=50&bestRole=1';
const result = (page = 1): Results => ({ ...identity, total: 100, page, limit: 50, players: [] });

test('first page caches its opposite direction synchronously and shares both pending requests', async () => {
  const cache = new PlayerPageCache('save', identity);
  let calls = 0;
  let resolve!: (value: Results) => void;
  const request = async (path: string) => {
    calls++;
    assert.match(path, /includeReversePage=1/);
    return new Promise<Results>(done => { resolve = done; });
  };
  const first = cache.load(query, request);
  assert.equal(cache.load(query, request), first);
  const opposite = cache.load(reversePageQuery(query), request);
  await setImmediate();
  assert.equal(calls, 1);
  resolve({ ...result(), reversePage: result() });
  await Promise.all([first, opposite]);
  assert.deepEqual(cache.peek(query), result());
  assert.deepEqual(cache.peek(reversePageQuery(query)), result());
  await cache.load(reversePageQuery(query), request);
  await cache.load(query, request);
  assert.equal(calls, 1);
  assert.equal(cache.prepared, true);
});

test('page keys retain filters, display columns, page size and rating identity', () => {
  assert.equal(pageQueryKey('page=1&sort=name&includeReversePage=1'), pageQueryKey('sort=name&page=1'));
  for (const suffix of ['role=af-attack', 'roleMin=50', 'roles=af-attack', 'nation=12', 'systemRevision=2']) {
    assert.notEqual(pageQueryKey(query), pageQueryKey(`${query}&${suffix}`));
  }
  const reverse = new URLSearchParams(reversePageQuery(query.replace('page=1', 'page=3')));
  assert.equal(reverse.get('page'), '1');
  assert.equal(reverse.get('direction'), 'asc');
  assert.equal(reverse.get('bestRole'), '1');
  assert.equal(reverse.get('limit'), '50');
});

test('LRU keeps 64 pages and refreshes recency on use', async () => {
  const cache = new PlayerPageCache('save', identity);
  const key = (page: number) => query.replace('page=1', `page=${page}`);
  const request = async (path: string) => result(Number(new URLSearchParams(path.split('?')[1]).get('page')));
  for (let page = 2; page <= 65; page++) await cache.load(key(page), request);
  await cache.load(key(2), request);
  await cache.load(key(66), request);
  assert.ok(cache.peek(key(2)));
  assert.equal(cache.peek(key(3)), null);
  assert.ok(cache.peek(key(66)));
});

test('failed requests and companion promises can be retried without retaining failures', async () => {
  const cache = new PlayerPageCache('save', identity);
  const pending = cache.load(query, async () => { throw new Error('offline'); });
  const reverse = cache.load(reversePageQuery(query), async () => result());
  await assert.rejects(pending, /offline/);
  await assert.rejects(reverse, /offline/);
  assert.equal(cache.peek(query), null);
  assert.equal(cache.prepared, false);
  await cache.load(query, async () => ({ ...result(), reversePage: result() }));
  assert.ok(cache.peek(query));
});

test('clearing a context aborts requests and ignores late responses even when transport ignores abort', async () => {
  const cache = new PlayerPageCache('save', identity);
  let resolve!: (value: Results) => void;
  let signal!: AbortSignal;
  const old = cache.load(query, async (_path, init) => {
    signal = init.signal!;
    return new Promise<Results>(done => { resolve = done; });
  });
  await setImmediate();
  cache.clear();
  assert.equal(signal.aborted, true);
  resolve({ ...result(), reversePage: result() });
  await assert.rejects(old, { name: 'AbortError' });
  assert.equal(cache.peek(query), null);
  assert.equal(cache.prepared, false);
  await cache.load(query, async () => result());
  assert.ok(cache.peek(query));
});

test('mismatched rating revisions never enter either page cache', async () => {
  const cache = new PlayerPageCache('save', identity);
  await assert.rejects(cache.load(query, async () => ({ ...result(), systemRevision: 2 })), { status: 409 });
  await assert.rejects(cache.load(query, async () => ({ ...result(), reversePage: { ...result(), systemRevision: 2 } })), { status: 409 });
  assert.equal(cache.peek(query), null);
  assert.equal(cache.peek(reversePageQuery(query)), null);
});

test('switching direction mid-request suppresses old callbacks without cancelling the shared work', async () => {
  const cache = new PlayerPageCache('save', identity);
  let resolve!: (value: Results) => void;
  let calls = 0;
  const transport = async () => {
    calls++;
    return new Promise<Results>(done => { resolve = done; });
  };
  const seen: string[] = [];
  const request = (path: string) => cache.load(path, transport);
  const stop = requestSnapshot({ path: query, request, onValue: () => seen.push('old'), onError: () => seen.push('error') });
  await setImmediate();
  stop();
  requestSnapshot({ path: reversePageQuery(query), request, onValue: () => seen.push('new'), onError: () => seen.push('error') });
  resolve({ ...result(), reversePage: result() });
  await setImmediate();
  assert.deepEqual(seen, ['new']);
  assert.equal(calls, 1);
});
