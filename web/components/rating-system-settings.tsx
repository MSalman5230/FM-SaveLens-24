"use client";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from '@/components/ui/combobox';
import { api, ApiError, type Attribute, type RatingSystem, type RatingSystems, type RoleCatalog, type RoleDefinition } from '@/lib/scout-api';
import { editRole, hybridEvidenceUrl, hybridSystemId, parseWeights, ratingCapacity, ratingModelNote, ratingSystemLabel, roleWeights, weightAttributes, weightDraft, weightGroup, weightGroups } from '@/lib/rating-systems';
import { roleLabel } from '@/lib/role-ratings';
import { watchRatingSettingsFocus, type RatingConflict, type RatingSettingsRefresh } from '@/lib/rating-settings-refresh';

type Intent = { kind: 'close' | 'tab' | 'system' | 'role' | 'new' | 'deleteSystem' | 'deleteRole'; value?: string };
type Naming = 'new' | 'system' | 'role';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function RatingSystemSettings({ open, onOpenChange, attributes, onCatalog, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attributes: Attribute[];
  onCatalog: (catalog: RoleCatalog) => void;
  children: ReactNode;
}) {
  const [tab, setTab] = useState('general');
  const [library, setLibrary] = useState<RatingSystems | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [system, setSystem] = useState<RatingSystem | null>(null);
  const [roleId, setRoleId] = useState('');
  const [systemName, setSystemName] = useState('');
  const [roleName, setRoleName] = useState('');
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [completedActions, setCompletedActions] = useState(0);
  const busy = working || loading;
  const readOnly = busy || !!library?.recovery;
  const { canAddSystem, canAddRole } = ratingCapacity(library, system);
  const refreshRef = useRef<ReturnType<typeof watchRatingSettingsFocus> | null>(null);
  const [conflict, setConflict] = useState<RatingConflict>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Intent | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [newName, setNewName] = useState('');
  const [deletion, setDeletion] = useState<'system' | 'role' | null>(null);
  const [roleSearch, setRoleSearch] = useState('');
  const allowed = useMemo(() => weightAttributes(attributes), [attributes]);
  const role = system?.roles.find(role => role.id === roleId);
  const originalWeights = role ? roleWeights(role) : {};
  const dirty = !!system && (systemName !== system.name || !!role && (roleName !== role.name ||
    [...new Set([...Object.keys(weights), ...Object.keys(originalWeights)])].some(key =>
      (weights[key] ?? '0').trim() === '' || Number(weights[key] ?? 0) !== (originalWeights[key] ?? 0))));
  const total = Object.values(weights).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const options = useMemo(() => (system?.roles ?? []).map(role => ({ value: role.id, label: roleLabel(role) }))
    .sort((a, b) => a.label.localeCompare(b.label)), [system]);
  const selectedOption = options.find(option => option.value === roleId) ?? null;
  const filtered = options.filter(option => roleSearch === selectedOption?.label || option.label.toLowerCase().includes(roleSearch.toLowerCase()));
  const systemOptions = (library?.systems ?? []).map(item => ({ value: item.id, label: ratingSystemLabel(item) }));
  if (system && !systemOptions.some(item => item.value === system.id)) {
    systemOptions.push({ value: system.id, label: `${system.name} · ${conflict === 'deleted' ? 'Deleted draft' : 'Loading'}` });
  }

  function selectRole(next: RoleDefinition) {
    refreshRef.current?.invalidate();
    setRoleId(next.id); setRoleName(next.name); setWeights(weightDraft(next)); setRoleSearch('');
  }
  function selectSystem(next: RatingSystem, preferredRole?: string) {
    setConflict(null);
    setSystem(next); setSystemName(next.name);
    selectRole(next.roles.find(role => role.id === preferredRole) ?? next.roles[0]);
  }

  // Keep the source fixed while a copy name or deletion confirmation is open.
  const getEditor = useEffectEvent(() => ({ system, dirty: dirty || naming !== null || deletion !== null || resetOpen }));
  const applyRefresh = useEffectEvent((next: RatingSettingsRefresh) => {
    setLibrary(next.library); onCatalog(next.library.catalog);
    if (next.system) selectSystem(next.system, roleId);
    setConflict(next.conflict); setError('');
  });
  useEffect(() => {
    if (!open) return;
    // oxlint-disable-next-line react/react-compiler -- reset feedback for a new remote editor session
    setError(''); setNotice(''); setConflict(null);
    const refresh = watchRatingSettingsFocus({
      target: window, request: api, getEditor,
      onValue: applyRefresh, onError: error => setError(errorText(error)), onLoading: setLoading,
    });
    refreshRef.current = refresh;
    void refresh.refresh();
    return () => { refresh.dispose(); refreshRef.current = null; };
  }, [open]);

  // Resume after React commits the saved definition, so queued focus reads see it.
  useEffect(() => {
    if (!working) refreshRef.current?.resume();
  }, [working, completedActions]);

  useEffect(() => {
    if (!open || !dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [open, dirty]);

  async function perform(action: () => Promise<void>): Promise<boolean> {
    refreshRef.current?.pause();
    setWorking(true); setError(''); setNotice('');
    try { await action(); return true; }
    catch (error) {
      setError(errorText(error));
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) void refreshRef.current?.refresh();
      return false;
    }
    finally { setWorking(false); setCompletedActions(value => value + 1); }
  }
  async function refreshLibrary() {
    const next = await api<RatingSystems>('/rating-systems');
    setLibrary(next); onCatalog(next.catalog);
  }
  async function persist(roles: RoleDefinition[], preferredRole = roleId) {
    if (!system) return;
    const saved = await api<RatingSystem>(`/rating-systems/${system.id}`, {
      method: 'PUT', body: JSON.stringify({ name: systemName, revision: system.revision, roles }),
    });
    selectSystem(saved, preferredRole);
    await refreshLibrary();
    setNotice('Changes saved.');
  }
  async function save() {
    if (!system || system.builtIn || conflict || readOnly) return false;
    return perform(async () => {
      await persist(editRole(system, roleId, roleName, parseWeights(weights, attributes)));
    });
  }
  function suggestName(base: string, existing: string[]) {
    const names = new Set(existing.map(name => name.toLowerCase()));
    let next = `${base.slice(0, 85)} copy`, suffix = 2;
    while (names.has(next.toLowerCase())) next = `${base.slice(0, 85)} copy ${suffix++}`;
    return next;
  }
  function openNaming(kind: Naming) {
    setError(''); setNaming(kind);
    setNewName(suggestName(kind === 'role' ? roleName : systemName,
      kind === 'role' ? (system?.roles ?? []).filter(item => item.duty === role?.duty).map(item => item.name) : (library?.systems ?? []).map(item => item.name)));
  }
  function execute(intent: Intent, current = system) {
    setError(''); setNotice('');
    if (intent.kind === 'close') onOpenChange(false);
    if (intent.kind === 'tab') setTab(intent.value!);
    if (intent.kind === 'role' && current) selectRole(current.roles.find(role => role.id === intent.value) ?? current.roles[0]);
    if (intent.kind === 'system') void perform(async () => selectSystem(await api<RatingSystem>(`/rating-systems/${intent.value}`), roleId));
    if (intent.kind === 'new') openNaming('new');
    if (intent.kind === 'deleteSystem' && current?.id === system?.id && !current?.builtIn) setDeletion('system');
    if (intent.kind === 'deleteRole' && current?.id === system?.id && current?.roles.some(role => role.id === roleId && role.id.startsWith('custom-'))) setDeletion('role');
  }
  function leave(intent: Intent) {
    if (busy) return;
    if (dirty) setPending(intent); else execute(intent);
  }
  async function saveNamed() {
    if (!system || !naming || readOnly || (naming === 'role' ? !canAddRole : !canAddSystem) || conflict && naming !== 'system') return;
    await perform(async () => {
      const name = newName.trim();
      if (!name || Array.from(name).length > 100) throw new Error('Names must contain 1–100 characters.');
      if (naming === 'role') {
        const id = `custom-${crypto.randomUUID()}`;
        await persist(editRole(system, roleId, name, parseWeights(weights, attributes), id), id);
      } else {
        const roles = naming === 'system' ? editRole(system, roleId, roleName, parseWeights(weights, attributes)) : undefined;
        const saved = await api<RatingSystem>('/rating-systems', {
          // Full draft definitions also survive deletion of their original source.
          method: 'POST', body: JSON.stringify({ sourceId: roles ? undefined : system.id, name, roles }),
        });
        selectSystem(saved, roleId); await refreshLibrary();
        setNotice('System saved. Choose Use system to activate it.');
      }
      setNaming(null);
    });
  }
  async function deleteConfirmed() {
    if (!system || conflict || readOnly) return;
    await perform(async () => {
      if (deletion === 'role') {
        await persist(system.roles.filter(role => role.id !== roleId), system.roles[0].id);
      } else {
        const next = await api<RatingSystems>(`/rating-systems/${system.id}`, { method: 'DELETE' });
        setLibrary(next); onCatalog(next.catalog);
        selectSystem(await api<RatingSystem>(`/rating-systems/${next.activeSystemId}`), roleId);
        setNotice('System deleted.');
      }
      setDeletion(null);
    });
  }

  return <>
    <Dialog open={open} onOpenChange={next => next ? onOpenChange(true) : leave({ kind: 'close' })}>
      <DialogContent className={`settings-dialog ${tab === 'ratings' ? 'rating-settings-dialog' : ''}`}>
        <DialogHeader><DialogTitle>Workspace settings</DialogTitle>
          <DialogDescription>Manage your save folder and weighted role ratings.</DialogDescription></DialogHeader>
        {library?.recovery && <div role="alert">
          <p>Saved rating systems could not be loaded. Browsing uses FM-Arena Hybrid Rating. Your original file is unchanged.</p>
          <p>{library.recovery.message}</p>
          <p>Reset to back up the file and start a new library, or repair rating-systems.json in the workspace data directory and restart.</p>
          <Button variant="outline" disabled={busy} onClick={() => { setError(''); setResetOpen(true); }}>Reset rating systems</Button>
        </div>}
        <Tabs value={tab} onValueChange={value => leave({ kind: 'tab', value: String(value) })}>
          <TabsList><TabsTrigger value="general">General</TabsTrigger><TabsTrigger value="ratings">Rating systems</TabsTrigger></TabsList>
          <TabsContent value="general" className="general-settings">{children}</TabsContent>
          <TabsContent value="ratings" className="rating-settings">
            <div className="rating-system-toolbar">
              <label className="rating-field" htmlFor="rating-system-picker">Rating system
                <Select items={systemOptions} value={system?.id ?? ''}
                  onValueChange={id => { if (id && id !== system?.id) leave({ kind: 'system', value: id }); }} disabled={busy}>
                  <SelectTrigger id="rating-system-picker" aria-label="Rating system"><SelectValue /></SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>{systemOptions.map(item =>
                    <SelectItem key={item.value} value={item.value}>{item.label}{item.value === library?.activeSystemId ? ' · Active' : ''}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <Button variant="outline" disabled={readOnly || !system || !!conflict || !canAddSystem} onClick={() => leave({ kind: 'new' })}>New system</Button>
              <Button disabled={readOnly || !system || dirty || !!conflict || system.id === library?.activeSystemId} onClick={() => void perform(async () => {
                const next = await api<RatingSystems>('/rating-systems/active', { method: 'PUT', body: JSON.stringify({ systemId: system!.id }) });
                setLibrary(next); onCatalog(next.catalog); setNotice(`${system!.name} is now active.`);
              })}>{system?.id === library?.activeSystemId ? 'Active system' : 'Use system'}</Button>
            </div>
            {library && <p className="muted">{library.systems.filter(item => !item.builtIn).length} of {library.limits.maxCustomSystems} custom systems · up to {library.limits.maxRolesPerSystem} profiles per system, including the 85 original profiles.</p>}
            {conflict && <div role="alert">
              <p>{conflict === 'deleted' ? 'This system was deleted in another window.' : 'This system was updated in another window.'} Your editor contents are preserved. Save them as a new system, or discard them and reload the saved settings.</p>
              <Button variant="outline" disabled={busy} onClick={() => { void refreshRef.current?.refresh(true); }}>Discard and reload</Button>
            </div>}
            {system && <>
              {system.builtIn && <p className="muted">Built-in preset · {ratingModelNote(system.id)} Choose New system to customize a copy.</p>}
              {system.id === hybridSystemId && <p className="muted">An evidence-informed performance index. Goalkeepers use separate GK evidence; Consistency contributes for outfield players. Position familiarity, set-piece taking, feet, morale, and condition are separate. <a href={hybridEvidenceUrl} target="_blank" rel="noreferrer">Research and methodology</a>.</p>}
              <label className="rating-field" htmlFor="rating-system-name">System name<Input id="rating-system-name" value={systemName} maxLength={100} disabled={readOnly || system.builtIn} onChange={event => setSystemName(event.target.value)} /></label>
              <div className="rating-editor-header">
                <label className="rating-field" htmlFor="rating-role-picker">Role and duty
                  <Combobox items={filtered} value={selectedOption} onValueChange={option => { if (option && option.value !== roleId) leave({ kind: 'role', value: option.value }); }}
                    onInputValueChange={setRoleSearch} itemToStringLabel={option => option.label} isItemEqualToValue={(a, b) => a.value === b.value} filter={null} disabled={busy}>
                    <ComboboxInput id="rating-role-picker" aria-label="Search roles to edit" placeholder="Search roles and duties…" />
                    <ComboboxContent><ComboboxEmpty>No matching roles</ComboboxEmpty><ComboboxList>{(option: { value: string; label: string }) =>
                      <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
                  </Combobox>
                </label>
                <label className="rating-field" htmlFor="rating-role-name">Role name<Input id="rating-role-name" value={roleName} maxLength={100} disabled={readOnly || system.builtIn} onChange={event => setRoleName(event.target.value)} /></label>
              </div>
              <p className="muted">Weight 0 excludes an attribute. Weights do not need to total 100. Rating = 5 × weighted sum ÷ total weight.</p>
              <div className="weight-groups">{weightGroups.map(group => <section className="weight-group" key={group}>
                <h3>{group}</h3><div className="weight-table-head" aria-hidden="true"><span>Attribute</span><span>Weight</span><span>Share</span></div>
                {allowed.filter(attribute => weightGroup(attribute) === group).map(attribute => {
                  const value = weights[attribute.key] ?? '0';
                  const share = Number(value) >= 0 && total > 0 && Number.isFinite(total) ? Number(value) / total * 100 : 0;
                  return <div className="weight-row" key={attribute.key}>
                    <label htmlFor={`weight-${attribute.key}`}>{attribute.label}</label>
                    <Input id={`weight-${attribute.key}`} aria-label={`${attribute.label} weight`} type="number" min="0" step="any" value={system.id === hybridSystemId ? Number(value).toFixed(4) : value}
                      disabled={readOnly || system.builtIn} onChange={event => setWeights(previous => ({ ...previous, [attribute.key]: event.target.value }))} />
                    <span>{Number.isFinite(share) ? share.toFixed(1) : '—'}%</span>
                  </div>;
                })}
              </section>)}</div>
              <div className="rating-editor-actions">
                <span className="muted">{dirty ? 'Unsaved changes' : `${system.roles.length} role profiles`}</span>
                <Button disabled={readOnly || system.builtIn || !dirty || !!conflict} onClick={() => void save()}>Save changes</Button>
                <Button variant="outline" disabled={readOnly || !canAddRole || !!conflict} onClick={() => openNaming('role')}>Save as new role</Button>
                <Button variant="outline" disabled={readOnly || !canAddSystem} onClick={() => openNaming('system')}>Save as new system</Button>
              </div>
              {!system.builtIn && <div className="rating-delete-actions">
                {roleId.startsWith('custom-') && <Button variant="outline" disabled={readOnly || !!conflict} onClick={() => leave({ kind: 'deleteRole' })}>Delete role</Button>}
                <Button variant="outline" disabled={readOnly || !!conflict} onClick={() => leave({ kind: 'deleteSystem' })}>Delete system</Button>
              </div>}
            </>}
            {!system && <p className="muted">{busy ? 'Loading rating systems…' : 'Rating systems could not be loaded. Close and reopen Settings to retry.'}</p>}
          </TabsContent>
        </Tabs>
        {error && <p className="error-text" role="alert">{error}</p>}
        {notice && <output className="settings-notice">{notice}</output>}
      </DialogContent>
    </Dialog>
    <AlertDialog open={resetOpen} onOpenChange={next => { if (!busy) setResetOpen(next); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Reset rating systems?</AlertDialogTitle>
        <AlertDialogDescription>The original file will be backed up in the workspace data directory before a fresh library is saved. FM-Arena Hybrid Rating will stay active. Your saves and snapshots are unchanged.</AlertDialogDescription></AlertDialogHeader>
        {error && <p className="error-text" role="alert">{error}</p>}
        <AlertDialogFooter><Button variant="outline" disabled={busy} onClick={() => setResetOpen(false)}>Cancel</Button>
          <Button disabled={busy || !library?.recovery} onClick={() => void perform(async () => {
            const next = await api<RatingSystems>('/rating-systems/reset', { method: 'POST', body: '{}' });
            setLibrary(next); onCatalog(next.catalog); setResetOpen(false);
            setNotice(`Rating systems reset. Original file saved as ${next.backupFilename} in the workspace data directory.`);
            selectSystem(await api<RatingSystem>(`/rating-systems/${next.activeSystemId}`));
          })}>{working ? 'Resetting…' : 'Back up and reset'}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={pending !== null} onOpenChange={next => { if (!next && !busy) setPending(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Save your changes?</AlertDialogTitle>
        <AlertDialogDescription>Your edits to {system?.name} have not been saved.</AlertDialogDescription></AlertDialogHeader>
        {error && <p className="error-text" role="alert">{error}</p>}
        <AlertDialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>Keep editing</Button>
          <Button variant="outline" disabled={busy} onClick={() => void (async () => {
            const intent = pending!;
            if (conflict && intent.kind !== 'close') {
              const next = await refreshRef.current?.refresh(true);
              if (!next) return;
              setPending(null); execute(intent, next.system ?? system);
            } else {
              setPending(null);
              if (system) selectSystem(system, roleId);
              execute(intent);
            }
          })()}>Discard</Button>
          <Button disabled={busy || !!conflict} onClick={() => void (async () => {
            if (await save()) { const intent = pending!; setPending(null); execute(intent); }
          })()}>Save and continue</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog open={naming !== null} onOpenChange={next => { if (!next && !busy) setNaming(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{naming === 'role' ? 'Save as new role' : naming === 'new' ? 'New rating system' : 'Save as new system'}</DialogTitle>
        <DialogDescription>{naming === 'role' ? 'The original role stays unchanged. Duty and role group are copied.' : 'Save an independent copy under a new name.'}</DialogDescription></DialogHeader>
        <label className="rating-field" htmlFor="rating-copy-name">Name<Input id="rating-copy-name" maxLength={100} value={newName} disabled={busy} onChange={event => setNewName(event.target.value)} /></label>
        {error && <p className="error-text" role="alert">{error}</p>}
        {conflict && naming !== 'system' && <p role="alert">This system changed in another window. Close this dialog to reload the saved settings or save your draft as a new system.</p>}
        <Button disabled={readOnly || (naming === 'role' ? !canAddRole : !canAddSystem) || !newName.trim() || !!conflict && naming !== 'system'} onClick={() => void saveNamed()}>{busy ? 'Saving…' : 'Save'}</Button>
      </DialogContent>
    </Dialog>
    <AlertDialog open={deletion !== null} onOpenChange={next => { if (!next && !busy) setDeletion(null); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deletion === 'role' ? role?.name : system?.name}?</AlertDialogTitle>
        <AlertDialogDescription>{deletion === 'role' ? 'This added role will be removed from this system.' : system?.id === library?.activeSystemId ? 'The app will switch back to FM-Arena Hybrid Rating.' : 'This custom system and its role weights will be removed.'}</AlertDialogDescription></AlertDialogHeader>
        {error && <p className="error-text" role="alert">{error}</p>}
        {conflict && <p role="alert">This system changed in another window. Cancel and reload the saved settings before deleting.</p>}
        <AlertDialogFooter><Button variant="outline" disabled={busy} onClick={() => setDeletion(null)}>Cancel</Button>
          <Button variant="destructive" disabled={readOnly || !!conflict} onClick={() => void deleteConfirmed()}>Delete</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
