"use client";

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/scout-api';
import { createUpdateController, initialUpdateView } from '@/lib/updates';

export function useUpdates() {
  const [view, setView] = useState(initialUpdateView);
  const controller = useRef<ReturnType<typeof createUpdateController> | null>(null);
  useEffect(() => {
    const current = createUpdateController({ request: api, publish: setView });
    controller.current = current;
    void current.refresh();
    const focus = () => { void current.refresh(); };
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('focus', focus);
      current.dispose();
      controller.current = null;
    };
  }, []);
  return {
    ...view,
    refresh: () => controller.current?.refresh(),
    check: () => controller.current?.check(true),
    automatic: (automatic: boolean) => controller.current?.preferences({ automatic }),
    dismiss: () => view.status?.latestVersion && controller.current?.preferences({ dismissedVersion: view.status.latestVersion }),
    openRelease: () => controller.current?.openRelease(),
  };
}

export type Updates = ReturnType<typeof useUpdates>;
