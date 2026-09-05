import type { api, RatingSystem, RatingSystems } from './scout-api.ts';

export type RatingEditor = { system: RatingSystem | null; dirty: boolean };
export type RatingConflict = 'changed' | 'deleted' | null;

export function reconcileRatingEditor(library: RatingSystems, editor: RatingEditor, discard = false) {
  const { system, dirty } = editor;
  const saved = library.systems.find(item => item.id === system?.id);
  const conflict: RatingConflict = system && !saved ? 'deleted'
    : system && saved?.revision !== system.revision ? 'changed' : null;
  if (system && dirty && !discard) return { loadId: null, conflict };
  return {
    loadId: !system || !saved ? library.activeSystemId : discard || conflict ? saved.id : null,
    conflict: null,
  };
}

export type RatingSettingsRefresh = {
  library: RatingSystems;
  system: RatingSystem | null;
  conflict: RatingConflict;
};

/** Owns only background reads; mutations pause it until their local state is committed. */
export function watchRatingSettingsFocus({ target, request, getEditor, onValue, onError, onLoading }: {
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  request: typeof api;
  getEditor: () => RatingEditor;
  onValue: (value: RatingSettingsRefresh) => void;
  onError: (error: unknown) => void;
  onLoading: (loading: boolean) => void;
}) {
  let controller: AbortController | undefined;
  let disposed = false, paused = false, queued = false, initialized = false;
  const invalidate = () => {
    controller?.abort();
    controller = undefined;
    onLoading(false);
  };
  const refresh = async (discard = false): Promise<RatingSettingsRefresh | null> => {
    if (disposed) return null;
    if (paused) { queued = true; return null; }
    invalidate();
    const current = new AbortController();
    controller = current;
    const { signal } = current;
    onLoading(true);
    try {
      const library = await request<RatingSystems>('/rating-systems', { signal });
      if (signal.aborted) return null;
      const editor = initialized ? getEditor() : { system: null, dirty: false };
      const choice = reconcileRatingEditor(library, editor, discard);
      const system = choice.loadId
        ? await request<RatingSystem>(`/rating-systems/${choice.loadId}`, { signal }) : null;
      if (signal.aborted) return null;
      // An edit made while the definition was in flight must keep its original revision.
      const latest = initialized ? getEditor() : editor;
      if (latest.system !== editor.system || latest.dirty !== editor.dirty) return await refresh();
      initialized = true;
      const value = { library, system, conflict: choice.conflict };
      controller = undefined;
      onLoading(false);
      onValue(value);
      return value;
    } catch (error) {
      if (!signal.aborted) onError(error);
      return null;
    } finally {
      if (controller === current) { controller = undefined; onLoading(false); }
    }
  };
  const focus = () => { void refresh(); };
  target.addEventListener('focus', focus);
  return {
    refresh,
    invalidate,
    pause() {
      paused = true;
      queued ||= controller !== undefined;
      invalidate();
    },
    resume() {
      paused = false;
      if (queued && !disposed) { queued = false; void refresh(); }
    },
    dispose() {
      disposed = true;
      invalidate();
      target.removeEventListener('focus', focus);
    },
  };
}
