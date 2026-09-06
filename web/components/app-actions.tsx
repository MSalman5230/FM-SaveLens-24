"use client";

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { api } from '@/lib/scout-api';
import { Switch } from '@/components/ui/switch';
import type { Updates } from '@/hooks/use-updates';

export function AppActions({ updates }: { updates: Updates }) {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!aboutOpen) return;
    const controller = new AbortController();
    void api<{ version: string }>('/health', { signal: controller.signal })
      .then(health => {
        if (!controller.signal.aborted) setVersion(health.version);
      })
      .catch(() => {
        if (!controller.signal.aborted) setVersionError('Could not load the app version.');
      });
    return () => controller.abort();
  }, [aboutOpen, attempt]);

  function changeAboutOpen(open: boolean) {
    setAboutOpen(open);
    if (open) {
      void updates.refresh();
      setVersion(null);
      setVersionError('');
    }
  }

  return (
    <Dialog open={aboutOpen} onOpenChange={changeAboutOpen}>
      <DialogTrigger render={<Button variant="ghost" />}>
        <Info size={16} /> About
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <Image src="/icons/app-128.png" alt="" width={64} height={64} />
          <DialogTitle>FM SaveLens 24</DialogTitle>
          <DialogDescription>Explore your Football Manager 2024 saves locally.</DialogDescription>
        </DialogHeader>
        <div className="about-version" aria-live="polite" aria-busy={!version && !versionError}>
          {version ? <p>Version {version}</p> : versionError ? <>
            <p role="alert">{versionError}</p>
            <Button variant="outline" onClick={() => { setVersionError(''); setAttempt(value => value + 1); }}>Retry</Button>
          </> : <p>Loading version…</p>}
        </div>
        {updates.status ? <>
          <div className="about-update-actions">
            <Button variant="outline" disabled={updates.busy || (updates.status.retryAt ?? 0) > updates.now}
              onClick={() => { void updates.check(); }}>{updates.checking ? 'Checking…' : 'Check for updates'}</Button>
            {updates.status.updateAvailable && <Button disabled={updates.busy} onClick={() => { void updates.openRelease(); }}>View release</Button>}
          </div>
          <div aria-live="polite" aria-busy={updates.checking}>
            {updates.status.updateAvailable && <p>Version {updates.status.latestVersion} is available.</p>}
            {!updates.checking && !updates.message && !updates.status.error && !updates.status.updateAvailable && updates.status.lastCheckedAt !== null && <p>You’re up to date.</p>}
            {updates.message && <p className="update-error" role="alert">{updates.message}</p>}
          </div>
          <p className="muted about-update-meta">{updates.status.lastCheckedAt !== null
            ? `Last successful check: ${new Date(updates.status.lastCheckedAt * 1000).toLocaleString()}`
            : 'No successful update check yet.'}
            {(updates.status.retryAt ?? 0) > updates.now && <> Next check available at {new Date(updates.status.retryAt! * 1000).toLocaleTimeString()}.</>}
          </p>
          <label className="about-update-toggle" htmlFor="automatic-update-checks">
            <Switch id="automatic-update-checks" checked={updates.status.automatic} disabled={updates.busy} onCheckedChange={(checked) => { void updates.automatic(checked); }} />
            Automatically check for updates
          </label>
          <p className="muted about-update-meta">Checks GitHub once a day while the app is open. No save data is sent. Download and install updates from the release page.</p>
        </> : <div aria-live="polite">
          <p>{updates.loaded ? 'Could not load update controls.' : 'Loading update controls…'}</p>
          {updates.loaded && <Button variant="outline" disabled={updates.busy} onClick={() => { void updates.refresh(); }}>Retry</Button>}
        </div>}
      </DialogContent>
    </Dialog>
  );
}
