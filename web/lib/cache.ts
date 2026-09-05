import { api } from './scout-api.ts';

export type CacheUsage = {
  diskBytes: number | null;
  snapshotCount: number | null;
  backendMemoryBytes: number | null;
  cacheRevision: string;
  canClear: boolean;
};
export type CacheClearResult = {
  usage: CacheUsage;
  removedBytes: number;
  removedCount: number;
  complete: boolean;
  failures: { file: string; error: string }[];
};
export function cacheSize(bytes: number | null): string {
  if (bytes === null) return 'Unavailable';
  if (bytes === 0) return '0 MB';
  if (bytes < 100_000) return '<0.1 MB';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

/** Every cache-backed request belongs to one revision and can be cancelled together. */
export class CacheLifecycle {
  revision: string | null = null;
  private controller = new AbortController();

  observe(revision: string): boolean {
    if (revision === this.revision) return false;
    const changed = this.revision !== null;
    this.revision = revision;
    this.cancel();
    return changed;
  }

  cancel() {
    this.controller.abort();
    this.controller = new AbortController();
  }

  request = async <T>(path: string, init: RequestInit = {}, request: typeof api = api): Promise<T> => {
    const controller = this.controller;
    const signal = init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
    if (this.revision && (path.startsWith('/snapshots/') || path.startsWith('/imports'))) {
      path += `${path.includes('?') ? '&' : '?'}cacheRevision=${encodeURIComponent(this.revision)}`;
    }
    const value = await request<T>(path, { ...init, signal });
    if (signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
    return value;
  };
}

export const isCacheAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/** Also works when desktop and browser clients do not share browser storage. */
export function watchCacheRevision({ target, visibility, request, onRevision }: {
  target: EventTarget;
  visibility: EventTarget & { visibilityState: string };
  request: typeof api;
  onRevision: (revision: string) => void;
}) {
  let controller: AbortController | undefined;
  const refresh = () => {
    controller?.abort();
    if (visibility.visibilityState !== 'visible') return;
    controller = new AbortController();
    const { signal } = controller;
    void request<{ cacheRevision: string }>('/settings', { signal })
      .then(value => { if (!signal.aborted) onRevision(value.cacheRevision); })
      .catch(() => { /* Resume synchronization on the next successful refresh. */ });
  };
  const timer = setInterval(refresh, 5000);
  target.addEventListener('focus', refresh);
  visibility.addEventListener('visibilitychange', refresh);
  refresh();
  return () => {
    controller?.abort();
    clearInterval(timer);
    target.removeEventListener('focus', refresh);
    visibility.removeEventListener('visibilitychange', refresh);
  };
}
