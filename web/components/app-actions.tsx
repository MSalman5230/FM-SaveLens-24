"use client";

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { api } from '@/lib/scout-api';

export function AppActions() {
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
      </DialogContent>
    </Dialog>
  );
}
