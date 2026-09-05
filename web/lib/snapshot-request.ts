// Tag data with both the save and request identity, so a render never pairs old
// ratings with a newly selected player, role, page, or save.
export type ScopedValue<T> = { key: string; value: T };
export const resourceKey = (snapshotId: string | undefined, identity: string | number | null) =>
  JSON.stringify([snapshotId, identity]);
export const currentValue = <T>(data: ScopedValue<T> | null, key: string): T | null =>
  data?.key === key ? data.value : null;

export function requestSnapshot<T>({
  path, request, onValue, onError, onSettled, delay = 0,
}: {
  path: string;
  request: (path: string, init: RequestInit) => Promise<T>;
  onValue: (data: T) => void;
  onError: (error: unknown) => void;
  onSettled?: () => void;
  delay?: number;
}) {
  const controller = new AbortController();
  const run = async () => {
    try {
      const value = await request(path, { signal: controller.signal });
      if (!controller.signal.aborted) onValue(value);
    } catch (error) {
      if (!controller.signal.aborted) onError(error);
    } finally {
      if (!controller.signal.aborted) onSettled?.();
    }
  };
  const timer = delay ? setTimeout(() => { void run(); }, delay) : undefined;
  if (!delay) void run();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
