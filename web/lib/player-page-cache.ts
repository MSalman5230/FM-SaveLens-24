import { ApiError } from './scout-api.ts';
import type { RatingIdentity, Results } from './scout-api.ts';

export function pageQueryKey(query: string): string {
  const params = new URLSearchParams(query);
  params.delete('includeReversePage');
  params.sort();
  return params.toString();
}

export function reversePageQuery(query: string): string {
  const params = new URLSearchParams(query);
  params.set('direction', params.get('direction') === 'asc' ? 'desc' : 'asc');
  params.set('page', '1');
  return pageQueryKey(params.toString());
}

/** One save/rating identity per instance. Never persisted in browser storage. */
export class PlayerPageCache {
  private pages = new Map<string, Results>();
  private sizes = new Map<string, number>();
  private pending = new Map<string, Promise<Results>>();
  private controller = new AbortController();
  prepared = false;
  private snapshotId: string;
  private identity: RatingIdentity | null;

  constructor(snapshotId: string, identity: RatingIdentity | null) {
    this.snapshotId = snapshotId;
    this.identity = identity;
  }

  peek(query: string): Results | null {
    return this.pages.get(pageQueryKey(query)) ?? null;
  }

  estimatedBytes(): number {
    return [...this.sizes.values()].reduce((sum, bytes) => sum + bytes, 0);
  }

  private put(key: string, value: Results) {
    this.pages.delete(key);
    this.pages.set(key, value);
    this.sizes.set(key, new TextEncoder().encode(JSON.stringify(value)).byteLength);
    if (this.pages.size > 64) {
      const oldest = this.pages.keys().next().value!;
      this.pages.delete(oldest);
      this.sizes.delete(oldest);
    }
  }

  load(query: string, request: (path: string, init: RequestInit) => Promise<Results>): Promise<Results> {
    const key = pageQueryKey(query);
    const cached = this.pages.get(key);
    if (cached) {
      this.put(key, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const params = new URLSearchParams(key);
    const paired = params.get('page') === '1';
    if (paired) params.set('includeReversePage', '1');
    const reverseKey = reversePageQuery(key);
    const controller = this.controller;
    let reversePending: Promise<Results> | undefined;
    const promise = Promise.resolve().then(() => request(
      `/snapshots/${this.snapshotId}/players?${params}`, { signal: controller.signal },
    )).then(value => {
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      const matches = (result: RatingIdentity) => this.identity !== null &&
        result.systemId === this.identity.systemId && result.systemRevision === this.identity.systemRevision;
      if (!matches(value) || (value.reversePage && !matches(value.reversePage)))
        throw new ApiError('The active rating system changed. Refresh ratings.', 409);
      const { reversePage, ...page } = value;
      this.prepared = true;
      this.put(key, page);
      if (reversePage) this.put(reverseKey, reversePage);
      return value;
    }).finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
      if (reversePending && this.pending.get(reverseKey) === reversePending) this.pending.delete(reverseKey);
    });
    this.pending.set(key, promise);
    if (paired && !this.pending.has(reverseKey)) {
      reversePending = promise.then(value => {
        if (!value.reversePage) throw new Error('The reverse page was not returned. Try again.');
        return value.reversePage;
      });
      // A companion need not have a subscriber; avoid unhandled rejections.
      void reversePending.catch(() => {});
      this.pending.set(reverseKey, reversePending);
    }
    return promise;
  }

  clear() {
    this.controller.abort();
    this.controller = new AbortController();
    this.pending.clear();
    this.pages.clear();
    this.sizes.clear();
    this.prepared = false;
  }
}
