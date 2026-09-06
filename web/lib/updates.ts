export type UpdateStatus = {
  version: string;
  automatic: boolean;
  dismissedVersion: string | null;
  lastCheckedAt: number | null;
  nextAutomaticCheckAt: number;
  retryAt: number | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  error: string | null;
};

export type UpdateView = {
  status: UpdateStatus | null;
  busy: boolean;
  checking: boolean;
  loaded: boolean;
  message: string;
  now: number;
};

export const initialUpdateView = (): UpdateView => ({
  status: null, busy: false, checking: false, loaded: false, message: '', now: Date.now() / 1000,
});

export function showUpdateBanner(status: UpdateStatus | null) {
  return !!status?.updateAvailable && status.latestVersion !== status.dismissedVersion;
}

// The controller is shared by About and the banner. Backend timestamps govern
// checks across restarts, browser tabs, and the desktop's changing local port.
export function createUpdateController({ request, publish, clock = () => Date.now() / 1000,
  schedule = (fn, ms) => setTimeout(fn, ms), cancel = (timer) => clearTimeout(timer),
}: {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  publish: (view: UpdateView) => void;
  clock?: () => number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  let view = initialUpdateView();
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  function emit(change: Partial<UpdateView>) {
    if (disposed) return;
    view = { ...view, ...change, now: clock() };
    publish(view);
  }
  function arm() {
    if (timer !== undefined) cancel(timer);
    if (disposed) return;
    const now = clock();
    const status = view.status;
    const due = status?.automatic ? status.nextAutomaticCheckAt : Infinity;
    const cooldown = status?.retryAt && status.retryAt > now ? status.retryAt : Infinity;
    // Refresh local state after transient local API failures without retrying GitHub eagerly.
    const next = status ? Math.min(due, cooldown) : now + 60;
    if (!Number.isFinite(next)) return;
    timer = schedule(() => {
      emit({});
      if (!view.status) void refresh();
      else if (view.status.automatic && view.status.nextAutomaticCheckAt <= clock()) void check(false);
      else arm();
    }, Math.min(2147483647, Math.max(1000, (next - now) * 1000)));
  }
  async function refresh() {
    if (disposed || view.busy) return;
    emit({ busy: true });
    try {
      const status = await request<UpdateStatus>('/updates', { signal: abort.signal });
      emit({ status, loaded: true });
    } catch {
      emit({ loaded: true });
    } finally {
      emit({ busy: false });
      arm();
    }
  }
  async function check(manual: boolean) {
    if (disposed || view.busy) return;
    emit({ busy: true, checking: true, message: '' });
    try {
      const status = await request<UpdateStatus>('/updates/check', {
        method: 'POST', body: JSON.stringify({ manual }), signal: abort.signal,
      });
      emit({ status, message: manual ? status.error ?? '' : '' });
    } catch {
      emit({ message: manual ? 'Could not check for updates. Please try again.' : '' });
      // If the local backend could not save its result, avoid a tight retry loop.
      if (view.status) emit({ status: { ...view.status, nextAutomaticCheckAt: clock() + 60 } });
    } finally {
      emit({ busy: false, checking: false });
      arm();
    }
  }
  async function preferences(change: { automatic: boolean } | { dismissedVersion: string }) {
    if (disposed || view.busy) return;
    emit({ busy: true, message: '' });
    try {
      const status = await request<UpdateStatus>('/updates', {
        method: 'PUT', body: JSON.stringify(change), signal: abort.signal,
      });
      emit({ status });
    } catch {
      emit({ message: 'Could not save your update preference. Please try again.' });
    } finally {
      emit({ busy: false });
      arm();
    }
  }
  async function openRelease() {
    if (disposed || view.busy) return;
    emit({ busy: true, message: '' });
    try {
      await request('/updates/open', { method: 'POST', body: '{}', signal: abort.signal });
    } catch {
      emit({ message: 'Could not open your browser. Visit github.com/MSalman5230/FM-SaveLens-24/releases to download the update.' });
    } finally {
      emit({ busy: false });
      arm();
    }
  }
  return {
    refresh, check, preferences, openRelease,
    dispose() { disposed = true; abort.abort(); if (timer !== undefined) cancel(timer); },
  };
}
