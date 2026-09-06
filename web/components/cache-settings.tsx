"use client";
import { useEffect, useEffectEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { api } from '@/lib/scout-api';
import { cacheSize, type CacheUsage, type CacheClearResult } from '@/lib/cache';

export function CacheSettings({ open, busy, clearing, memoryBytes, onClearing, onCleared, onRevision, request }: {
  open: boolean;
  busy: boolean;
  clearing: boolean;
  memoryBytes: () => number;
  onClearing: (value: boolean) => void;
  onCleared: (result: CacheClearResult) => void;
  onRevision: (revision: string) => void;
  request: typeof api;
}) {
  const [usage, setUsage] = useState<CacheUsage | null>(null);
  const [browserBytes, setBrowserBytes] = useState(0);
  const [error, setError] = useState('');
  const [clearError, setClearError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const readMemory = useEffectEvent(memoryBytes);
  const observeRevision = useEffectEvent(onRevision);
  useEffect(() => {
    if (!open || clearing) return;
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      if (document.visibilityState !== 'visible') return;
      controller = new AbortController();
      const { signal } = controller;
      setLoading(true);
      setBrowserBytes(readMemory());
      void request<CacheUsage>('/cache', { signal }).then(value => {
        if (signal.aborted) return;
        observeRevision(value.cacheRevision);
        setUsage(value); setBrowserBytes(readMemory()); setError('');
      }).catch(error => {
        if (!signal.aborted) { setUsage(null); setError(String(error.message ?? error)); }
      }).finally(() => { if (!signal.aborted) setLoading(false); });
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller?.abort(); clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [open, clearing, request]);

  async function clear() {
    onClearing(true); setConfirm(false); setError(''); setClearError(''); setNotice('');
    try {
      const result = await api<CacheClearResult>('/cache', { method: 'DELETE' });
      onCleared(result);
      setUsage(result.usage); setBrowserBytes(0);
      setNotice(`${result.complete ? 'Cache cleared.' : 'Cache partially cleared.'} Removed ${cacheSize(result.removedBytes)} from disk. Read a save to load it again.`);
      if (!result.complete) setClearError(result.failures.map(f => `${f.file}: ${f.error}`).join('\n') || 'Some cache files remain. Try clearing again.');
    } catch (error) {
      setClearError(error instanceof Error ? error.message : String(error));
      // A lost response may follow a committed clear. Synchronize before retrying.
      try {
        const next = await api<CacheUsage>('/cache');
        onRevision(next.cacheRevision); setUsage(next);
      } catch { setUsage(null); }
    } finally { onClearing(false); }
  }

  const disabled = busy || clearing || !usage?.canClear;
  return <section aria-labelledby="cache-heading" className="cache-settings">
    <h3 id="cache-heading">Cache</h3>
    <dl className="cache-usage" aria-busy={loading}>
      <div><dt>Disk cache</dt><dd>{usage ? cacheSize(usage.diskBytes) : loading ? 'Loading…' : 'Unavailable'}{usage?.snapshotCount != null && <span className="muted"> · {usage.snapshotCount} cached {usage.snapshotCount === 1 ? 'save' : 'saves'}</span>}</dd></div>
      <div><dt>Memory cache · backend</dt><dd>{usage ? cacheSize(usage.backendMemoryBytes) : loading ? 'Loading…' : 'Unavailable'}</dd></div>
      <div><dt>Memory cache · this window (estimate)</dt><dd>{cacheSize(browserBytes)}</dd></div>
    </dl>
    <p className="muted">Memory readings cover cached ratings and results, not total app or browser memory. Released memory may stay reserved by the runtime.</p>
    <p className="muted">Clearing removes cached game data for all saves and closes the loaded save. Original FM saves, rating systems, and preferences are kept.</p>
    <Button variant="outline" disabled={disabled} onClick={() => setConfirm(true)}>{clearing ? 'Clearing…' : 'Clear all cache'}</Button>
    {(busy || usage && !usage.canClear) && <p className="muted">Finish or cancel the current import before clearing the cache.</p>}
    {notice && <output>{notice}</output>}
    {error && <p role="alert" className="cache-error">{error}</p>}
    {clearError && <p role="alert" className="cache-error">{clearError}</p>}
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Clear all cache?</AlertDialogTitle><AlertDialogDescription>Remove all cached saves from disk and memory and close the loaded save in open SaveLens windows. You will need to read a save again. Your original saves, rating systems, and preferences are kept.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button><Button disabled={disabled} onClick={() => void clear()}>Clear all cache</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
