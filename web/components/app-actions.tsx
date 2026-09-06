"use client";

import Image from 'next/image';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { ExternalLink, Info, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { api } from '@/lib/scout-api';

const subscribeDesktop = () => () => {};
const serverDesktop = () => false;

export function AppActions() {
  const desktop = useSyncExternalStore(subscribeDesktop, isTauri, serverDesktop);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [browserError, setBrowserError] = useState('');
  const browserPending = useRef(false);

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

  async function openBrowser() {
    if (browserPending.current) return;
    browserPending.current = true;
    setOpeningBrowser(true);
    setBrowserError('');
    try {
      await invoke('open_in_browser');
    } catch (error) {
      setBrowserError(error instanceof Error ? error.message : String(error));
    } finally {
      browserPending.current = false;
      setOpeningBrowser(false);
    }
  }

  return <>
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
    {desktop && <div className="browser-action">
      <Button variant="ghost" disabled={openingBrowser} onClick={() => void openBrowser()} aria-describedby={browserError ? 'browser-action-error' : undefined}>
        {openingBrowser ? <LoaderCircle size={16} className="animate-spin" /> : <ExternalLink size={16} />}
        {openingBrowser ? 'Opening…' : 'Open in Browser'}
      </Button>
      {browserError && <p id="browser-action-error" className="browser-action-error" role="alert">{browserError} Try again.</p>}
    </div>}
  </>;
}
