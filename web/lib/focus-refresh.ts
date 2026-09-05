import type { api, SaveFile, Snapshot } from './scout-api';

type FocusRefreshOptions = {
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  snapshotId: string;
  request: typeof api;
  setSnapshot: (update: (current: Snapshot | null) => Snapshot | null) => void;
  setSaves: (saves: SaveFile[]) => void;
};

export function watchSnapshotFocus({
  target,
  snapshotId,
  request,
  setSnapshot,
  setSaves,
}: FocusRefreshOptions): () => void {
  let controller: AbortController | undefined;
  const refresh = () => {
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    void request<Snapshot>('/snapshots/' + snapshotId, { signal })
      .then((snapshot) => {
        if (signal.aborted) return;
        // React may apply this updater after a save switch or effect cleanup.
        setSnapshot((current) =>
          !signal.aborted &&
          current?.snapshotId === snapshotId &&
          snapshot.snapshotId === snapshotId
            ? snapshot
            : current,
        );
      })
      .catch(() => {});
    void request<{ saves: SaveFile[] }>('/saves', { signal })
      .then((list) => {
        if (!signal.aborted) setSaves(list.saves);
      })
      .catch(() => {});
  };
  target.addEventListener('focus', refresh);
  return () => {
    controller?.abort();
    target.removeEventListener('focus', refresh);
  };
}
