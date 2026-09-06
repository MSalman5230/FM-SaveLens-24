"use client";

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showUpdateBanner } from '@/lib/updates';
import type { Updates } from '@/hooks/use-updates';

export function UpdateBanner({ updates }: { updates: Updates }) {
  if (!showUpdateBanner(updates.status)) return null;
  return <output className="update-banner">
    <span>Version {updates.status?.latestVersion} is available</span>
    <Button variant="outline" size="sm" disabled={updates.busy} onClick={() => { void updates.openRelease(); }}>View release</Button>
    <Button variant="ghost" size="sm" disabled={updates.busy} aria-label="Dismiss this update" onClick={() => { void updates.dismiss(); }}><X size={16} /></Button>
    {updates.message && <span className="update-error">{updates.message}</span>}
  </output>;
}
