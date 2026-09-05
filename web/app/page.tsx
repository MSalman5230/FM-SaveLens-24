"use client";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Search,
  FolderOpen,
  Settings2,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
  Plus,
  SlidersHorizontal,
  Database,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { api, ApiError, date, size } from "@/lib/scout-api";
import { watchSnapshotFocus } from "@/lib/focus-refresh";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RoleRatings } from "@/components/role-ratings";
import { RatingSystemSettings } from "@/components/rating-system-settings";
import { ratingIdentity, ratingParams, reconcileRatingView, sameRatingSystem } from "@/lib/rating-systems";
import { playerQuery, roleLabel, selectRole } from "@/lib/role-ratings";
import { PlayerColumnChooser } from "@/components/player-column-chooser";
import { PlayerListTable } from "@/components/player-list-table";
import { PositionFilter, PositionMatching } from "@/components/position-filter";
import { activeFilterCount, advancedFilterCount, defaultPositionFilters, selectedPositions, selectPositions } from "@/lib/position-filter";
import type { PositionMatch } from "@/lib/position-filter";
import { columnStorageKey, legacyColumnStorageKey, defaultColumns, normalizeColumns, playerColumns, restoreColumnPreferences, resolveColumnSort, visibleSort } from "@/lib/player-columns";
import { currentValue, requestSnapshot, resourceKey } from "@/lib/snapshot-request";
import { PlayerPageCache } from "@/lib/player-page-cache";
import type { ScopedValue } from "@/lib/snapshot-request";
import type {
  Attribute,
  Option,
  SaveFile,
  Job,
  Snapshot,
  Detail,
  Results,
  RoleCatalog,
} from "@/lib/scout-api";

function Picker({
  label,
  options,
  value,
  onChange,
  placeholder = "Any",
  disabled = false,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(
    () =>
      options
        .filter(
          (o) =>
            text === selected?.label ||
            o.label.toLocaleLowerCase().includes(text.toLocaleLowerCase()),
        )
        .slice(0, 100),
    [options, text, selected?.label],
  );
  return (
    <Combobox
      items={filtered}
      value={selected}
      onValueChange={(v) => onChange(v?.value ?? "")}
      onInputValueChange={setText}
      itemToStringLabel={(o) => o.label}
      isItemEqualToValue={(a, b) => a.value === b.value}
      filter={null}
      disabled={disabled}
    >
      <ComboboxInput
        id={label.replace(/\W/g, "-").toLowerCase()}
        aria-label={label}
        placeholder={placeholder}
        showClear={!!value}
      />
      <ComboboxContent>
        <ComboboxEmpty>No matches</ComboboxEmpty>
        <ComboboxList>
          {(o: Option) => (
            <ComboboxItem key={o.value} value={o}>
              <span className="picker-option">
                {o.label}
                {o.description && <small>{o.description}</small>}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <Select items={options} value={value} onValueChange={(v) => onChange(v ?? "")}>
      <SelectTrigger id={label.replace(/\W/g, "-").toLowerCase()} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
const groups = ["Technical", "Mental", "Physical", "Goalkeeping", "Feet", "Hidden"];
const defaultFilters: Record<string, string> = {
  q: "",
  club: "",
  nation: "",
  ...defaultPositionFilters,
  role: "",
  roleMin: "",
  ageMin: "",
  ageMax: "",
  caMin: "",
  caMax: "",
  paMin: "",
  paMax: "",
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function ratingClass(v: number | null | undefined) {
  return v == null
    ? "rating unavailable"
    : v >= 16
      ? "rating excellent"
      : v >= 11
        ? "rating good"
        : "rating";
}

export default function Home() {
  const [saves, setSaves] = useState<SaveFile[]>([]),
    [selected, setSelected] = useState(""),
    [folder, setFolder] = useState("");
  const [attributes, setAttributes] = useState<Attribute[]>([]),
    [positions, setPositions] = useState<string[]>([]);
  const [roleCatalog, setRoleCatalog] = useState<RoleCatalog | null>(null);
  const applyRoleCatalog = useCallback((next: RoleCatalog) => {
    setRoleCatalog(previous => sameRatingSystem(next, previous) ? previous : next);
  }, []);
  const refreshRoleCatalog = useCallback(async () => {
    applyRoleCatalog(await api<RoleCatalog>('/roles'));
  }, [applyRoleCatalog]);
  const [columnIds, setColumnIds] = useState<string[]>(defaultColumns);
  const availableColumns = useMemo(() => playerColumns(roleCatalog?.roles ?? []), [roleCatalog]);
  const displayedColumns = useMemo(() => columnIds.flatMap(id => availableColumns.filter(column => column.id === id)), [columnIds, availableColumns]);
  const displayedRoleIds = useMemo(() => displayedColumns.flatMap(column => column.roleId ? [column.roleId] : []).sort(), [displayedColumns]);
  const displayBestRole = columnIds.includes('bestRoleRating');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [job, setJob] = useState<Job | null>(null),
    [starting, setStarting] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [initializing, setInitializing] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false),
    [folderDraft, setFolderDraft] = useState(""),
    [folderError, setFolderError] = useState(""),
    [savingFolder, setSavingFolder] = useState(false);
  const [filters, setFilters] = useState(defaultFilters),
    [sort, setSort] = useState("pa"),
    [direction, setDirection] = useState("desc"),
    [page, setPage] = useState(1),
    [limit, setLimit] = useState("50");
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [searchResponse, setSearchResponse] = useState<ScopedValue<Results> | null>(null),
    [spinnerKey, setSpinnerKey] = useState<string | null>(null),
    [searchError, setSearchError] = useState("");
  const [attributeKey, setAttributeKey] = useState(""),
    [attributeMin, setAttributeMin] = useState("15");
  const [detailId, setDetailId] = useState<number | null>(null),
    [detailResponse, setDetailResponse] = useState<ScopedValue<Detail> | null>(null),
    [detailError, setDetailError] = useState("");
  const [detailRole, setDetailRole] = useState("");
  const jobId = job?.id,
    jobStatus = job?.status,
    snapshotId = snapshot?.snapshotId;
  const running = jobStatus === "running";
  const systemKey = ratingIdentity(roleCatalog);
  const systemQuery = ratingParams(roleCatalog);
  const pageCache = useMemo(() => new PlayerPageCache(snapshotId ?? '', roleCatalog), [snapshotId, roleCatalog]);
  useEffect(() => () => pageCache.clear(), [pageCache]);
  const previousFilters = useRef(filters);
  const detailKey = resourceKey(snapshotId, `${detailId}:${systemKey}`);
  const detail = currentValue(detailResponse, detailKey);
  const chosen = saves.find((s) => s.id === selected);
  const applySaves = useCallback((files: SaveFile[], preferSnapshot?: string) => {
    setSaves(files);
    setSelected((old) =>
      files.some((s) => s.id === old)
        ? old
        : ((
            files.find((s) => s.snapshotId === preferSnapshot) ??
            files[0]
          )?.id ?? ""),
    );
  }, []);
  const refresh = useCallback(async (preferSnapshot?: string) => {
    const list = await api<{ saves: SaveFile[] }>("/saves");
    applySaves(list.saves, preferSnapshot);
  }, [applySaves]);
  const loadSnapshot = useCallback(async (id: string) => {
    const meta = await api<Snapshot>("/snapshots/" + id);
    setSnapshot(meta);
    setDetailId(null);
    setPage(1);
  }, []);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [settings, catalog, roles] = await Promise.all([
          api<{ folder: string; lastSnapshot?: string; activeJob: Job | null }>("/settings"),
          api<{ attributes: Attribute[]; positions: string[] }>("/attributes"),
          api<RoleCatalog>("/roles"),
        ]);
        if (!live) return;
        setFolder(settings.folder);
        if (!settings.folder) {
          setFolderDraft("");
          setSettingsOpen(true);
        }
        setAttributes(catalog.attributes);
        setPositions(catalog.positions);
        setRoleCatalog(roles);
        try {
          const restored = restoreColumnPreferences(window.localStorage.getItem(columnStorageKey), window.localStorage.getItem(legacyColumnStorageKey), playerColumns(roles.roles));
          const nextSort = resolveColumnSort(restored, 'pa', 'desc', '');
          setColumnIds(restored);
          setSort(nextSort.sort);
          setDirection(nextSort.direction);
          setPage(1);
        }
        catch { /* The default view works when device storage is unavailable. */ }
        setJob(settings.activeJob);
        await refresh(settings.lastSnapshot);
        if (settings.lastSnapshot) await loadSnapshot(settings.lastSnapshot);
      } catch (e) {
        if (live) setError(errorText(e));
      } finally {
        if (live) setInitializing(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [refresh, loadSnapshot]);
  useEffect(() => {
    if (!jobId || jobStatus !== "running") return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Job>("/imports/" + jobId);
        if (cancelled) return;
        setJob(next);
        if (next.status === "complete") {
          await loadSnapshot(next.snapshotId);
          await refresh(next.snapshotId);
          setNotice("Save loaded. Player ratings are ready.");
        } else if (next.status === "error") setError(next.message);
        else if (next.status === "running") timer = setTimeout(poll, 450);
      } catch (e) {
        if (!cancelled) {
          setError(errorText(e));
          timer = setTimeout(poll, 2000);
        }
      }
    };
    timer = setTimeout(poll, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, jobStatus, loadSnapshot, refresh]);
  // Recheck the source when returning to the app after playing or saving in FM.
  useEffect(() => {
    if (!snapshotId) return;
    return watchSnapshotFocus({
      target: window,
      snapshotId,
      request: api,
      setSnapshot,
      setSaves: applySaves,
    });
  }, [snapshotId, applySaves]);
  const [viewSystemKey, setViewSystemKey] = useState('');
  if (roleCatalog && viewSystemKey !== systemKey) {
    setViewSystemKey(systemKey);
    const next = reconcileRatingView(roleCatalog, filters, columnIds, sort, direction);
    setFilters(next.filters);
    setColumnIds(next.columnIds);
    setSort(next.sort);
    setDirection(next.direction);
    setDetailRole(previous => roleCatalog.roles.some(role => role.id === previous) ? previous : '');
    setPage(1);
  }
  useEffect(() => {
    if (initializing) return;
    try { window.localStorage.setItem(columnStorageKey, JSON.stringify(columnIds)); } catch { /* Device preferences are optional. */ }
  }, [columnIds, initializing]);
  // Another local window may change the workspace's active system.
  useEffect(() => {
    const refresh = () => { void refreshRoleCatalog().catch(e => setError(errorText(e))); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refreshRoleCatalog]);
  const query = useMemo(() => [playerQuery(filters, sort, direction, page, limit, displayedRoleIds, displayBestRole), systemQuery].filter(Boolean).join('&'), [filters, sort, direction, page, limit, displayedRoleIds, displayBestRole, systemQuery]);
  const searchKey = resourceKey(snapshotId, query);
  const result = pageCache.peek(query) ?? currentValue(searchResponse, searchKey);
  const searching = Boolean(snapshotId && roleCatalog && !result && !searchError);
  const showSearchSpinner = searching && spinnerKey === searchKey;
  const searchMessage = pageCache.prepared ? 'Searching players…' : 'Preparing player ratings…';
  // Remote request state must reset whenever a new search starts.
  // oxlint-disable-next-line react/react-compiler
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- reset state for this remote request
    setSpinnerKey(null);
    setSearchError("");
    const filtersChanged = previousFilters.current !== filters;
    previousFilters.current = filters;
    if (!snapshotId || !roleCatalog) return;
    const cached = pageCache.peek(query);
    if (cached) {
      void pageCache.load(query, api<Results>); // Touch the LRU without a request.
      setSearchResponse({ key: searchKey, value: cached });
      return;
    }
    const spinner = setTimeout(() => setSpinnerKey(searchKey), pageCache.prepared ? 150 : 0);
    const stop = requestSnapshot<Results>({
      path: query, request: path => pageCache.load(path, api<Results>), delay: filtersChanged ? 200 : 0,
      onValue: value => {
        if (sameRatingSystem(value, roleCatalog)) setSearchResponse({ key: searchKey, value });
        else void refreshRoleCatalog().catch(e => setSearchError(errorText(e)));
      },
      onError: e => {
        setSearchResponse(null);
        if (e instanceof ApiError && e.status === 409) void refreshRoleCatalog().catch(error => setSearchError(errorText(error)));
        else setSearchError(errorText(e));
      },
      onSettled: () => { clearTimeout(spinner); setSpinnerKey(null); },
    });
    return () => { clearTimeout(spinner); stop(); };
  }, [snapshotId, query, searchKey, roleCatalog, refreshRoleCatalog, pageCache, filters]);
  // Clear the previous player's remote data before requesting another identity.
  // oxlint-disable-next-line react/react-compiler
  useEffect(() => {
    // oxlint-disable-next-line react/react-compiler -- prevent displaying the previous identity
    setDetailResponse(null);
    setDetailError("");
    if (detailId === null || !snapshotId || !roleCatalog) return;
    return requestSnapshot<Detail>({
      path: `/snapshots/${snapshotId}/players/${detailId}?${systemQuery}`, request: api,
      onValue: value => {
        if (sameRatingSystem(value, roleCatalog)) setDetailResponse({ key: detailKey, value });
        else void refreshRoleCatalog().catch(e => setDetailError(errorText(e)));
      },
      onError: e => {
        if (e instanceof ApiError && e.status === 409) void refreshRoleCatalog().catch(error => setDetailError(errorText(error)));
        else setDetailError(errorText(e));
      },
    });
  }, [detailId, snapshotId, detailKey, systemQuery, roleCatalog, refreshRoleCatalog]);
  function openPlayer(id: number, roleId?: string) {
    setDetailRole(roleId ?? (sort.startsWith('role:') ? sort.slice(5) : filters.role));
    setDetailId(id);
  }
  function saveColumns(ids: string[]) {
    const next = normalizeColumns(ids, availableColumns);
    setColumnIds(next);
    try { window.localStorage.setItem(columnStorageKey, JSON.stringify(next)); }
    catch { /* Column editing remains available without device storage. */ }
    return next;
  }
  function changeColumns(ids: string[]) {
    const next = saveColumns(ids);
    const nextSort = resolveColumnSort(next, sort, direction, filters.role);
    if (nextSort.sort !== sort) { setSort(nextSort.sort); setDirection(nextSort.direction); setPage(1); }
  }
  function changeRole(role: string) {
    const nextColumns = role ? saveColumns([...columnIds, `role:${role}`]) : columnIds;
    const next = selectRole(filters, sort, direction, role);
    const nextSort = resolveColumnSort(nextColumns, next.sort, next.direction, role);
    setFilters(next.filters);
    setSort(nextSort.sort);
    setDirection(nextSort.direction);
    setPage(next.page);
  }
  const updateFilter = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const changePositions = (positions: string[], match?: PositionMatch) => {
    const next = selectPositions(filters, positions, match);
    setFilters(next.filters);
    setPage(next.page);
  };
  const clearFilters = () => {
    const nextSort = resolveColumnSort(columnIds, sort, direction, '');
    setFilters({ ...defaultFilters });
    setSort(nextSort.sort);
    setDirection(nextSort.direction);
    setPage(1);
  };
  async function importSave() {
    if (!selected) return;
    setStarting(true);
    setError("");
    setNotice("");
    try {
      const next = await api<Job>("/imports", {
        method: "POST",
        body: JSON.stringify({ saveId: selected }),
      });
      setJob(next);
      if (next.status === "complete") {
        await loadSnapshot(next.snapshotId);
        await refresh(next.snapshotId);
        setNotice("Loaded from your local cache.");
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  }
  async function cancelImport() {
    if (!job) return;
    try {
      const next = await api<Job>("/imports/" + job.id, { method: "DELETE" });
      setJob(next);
      if (next.status === "complete") await loadSnapshot(next.snapshotId);
      else setNotice("Import cancelled.");
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function saveFolder() {
    setSavingFolder(true);
    setFolderError("");
    try {
      const settings = await api<{ folder: string }>("/settings", {
        method: "PUT",
        body: JSON.stringify({ folder: folderDraft }),
      });
      setFolder(settings.folder);
      setSnapshot(null);
      setDetailId(null);
      setSearchResponse(null);
      setJob(null);
      clearFilters();
      await refresh();
      setSettingsOpen(false);
      setError("");
      setNotice("Save folder updated.");
    } catch (e) {
      setFolderError(errorText(e));
    } finally {
      setSavingFolder(false);
    }
  }
  const clubOptions = useMemo(
    () => [
      { value: "-1", label: "Club unavailable" },
      ...(snapshot?.clubs ?? []).map((c) => ({ value: String(c.id), label: c.name })),
    ],
    [snapshot?.clubs],
  );
  const nationOptions = useMemo(
    () => (snapshot?.nations ?? []).map((c) => ({ value: String(c.id), label: c.name })),
    [snapshot?.nations],
  );
  const attrOptions = useMemo(
    () =>
      attributes
        .map((a) => ({ value: a.key, label: a.label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [attributes],
  );
  const saveOptions = useMemo(
    () =>
      saves.map((s) => ({
        value: s.id,
        label: s.name,
        description: `${size(s.size)} · ${date(s.modified)} · ${s.cached ? "Cached" : "Not imported"}`,
      })),
    [saves],
  );
  const attrFilters = Object.entries(filters).filter(([k, v]) => k.startsWith("attr_") && v);
  const roleOptions = useMemo(() => (roleCatalog?.roles ?? [])
    .map(role => ({ value: role.id, label: roleLabel(role), description: role.group }))
    .sort((a, b) => a.label.localeCompare(b.label)), [roleCatalog]);
  const selectedRole = roleCatalog?.roles.find(role => role.id === filters.role);
  const activeFilters = activeFilterCount(filters);
  const advancedFilters = advancedFilterCount(filters);
  function changeSort(key: string) {
    setSort(key);
    setDirection(
      visibleSort(sort, filters.role) === key
        ? direction === "desc"
          ? "asc"
          : "desc"
        : key === "name" || key === "club"
          ? "asc"
          : "desc",
    );
    setPage(1);
  }
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / Number(limit)));
  // Progressive enhancement: browser agents use the same filters and player panel as people.
  useEffect(() => {
    type Tool = {
      name: string;
      description: string;
      inputSchema: unknown;
      annotations: {readOnlyHint:boolean;untrustedContentHint:boolean};
      execute: (args: Record<string, unknown>) => Promise<unknown>;
    };
    const context = (
      document as Document & {
        modelContext?: { registerTool: (t: Tool, options:{signal:AbortSignal}) => void|Promise<void> };
      }
    ).modelContext;
    if (!context || !snapshotId) return;
    const lifecycle=new AbortController();
    const register=(tool:Tool)=>{try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(e=>console.warn('Browser tool registration failed',e));}catch(e){console.warn('Browser tool registration failed',e);}};
    register({
      name: "search_players",
      annotations:{readOnlyHint:false,untrustedContentHint:true},
      description:
        "Search players in the loaded FM24 save and apply the same filters to the visible table.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          minimumPotential: { type: "integer", minimum: 1, maximum: 200 },
        },
        additionalProperties: false,
      },
      execute: async (args) => {
        const q = typeof args.name === "string" ? args.name.slice(0, 200) : "";
        const pa = Number(args.minimumPotential ?? 1);
        if (!Number.isInteger(pa) || pa < 1 || pa > 200)
          throw new Error("Potential must be 1–200.");
        const nextFilters = { ...defaultFilters, q, paMin: String(pa) };
        const nextSort = resolveColumnSort(columnIds, 'pa', 'desc', '');
        const nextQuery = [playerQuery(nextFilters, nextSort.sort, nextSort.direction, 1, '50', displayedRoleIds, displayBestRole), systemQuery].filter(Boolean).join('&');
        const found = await pageCache.load(nextQuery, api<Results>);
        if (lifecycle.signal.aborted) throw new Error('The active save or view changed.');
        flushSync(()=>{setFilters(nextFilters);setSort(nextSort.sort);setDirection(nextSort.direction);setPage(1);setLimit('50');setSearchResponse({key:resourceKey(snapshotId,nextQuery),value:found});});
        return found;
      },
    });
    register({
      name: "open_player",
      annotations:{readOnlyHint:false,untrustedContentHint:true},
      description: "Open a player by entity ID from the currently loaded save.",
      inputSchema: {
        type: "object",
        properties: { playerId: { type: "integer", minimum: 0 } },
        required: ["playerId"],
        additionalProperties: false,
      },
      execute: async (args) => {
        const id = Number(args.playerId);
        if (!Number.isInteger(id) || id < 0) throw new Error("Invalid player ID.");
        const p = await api<Detail>(`/snapshots/${snapshotId}/players/${id}`);
        if (lifecycle.signal.aborted) throw new Error('The active save changed.');
        flushSync(()=>{setDetailRole('');setDetailId(p.id);});
        return {id:p.id,name:p.name,status:'opened'};
      },
    });
    return () => {
      lifecycle.abort();
    };
  }, [snapshotId, displayedRoleIds, columnIds, displayBestRole, systemQuery, pageCache]);

  return (
    <main className="scout-app">
      <header className="masthead">
        <div className="brand">
          <Image className="brand-icon" src="/icons/app-128.png" alt="" width={40} height={40} />
          <strong>
            FM<span>SAVELENS</span>
          </strong>
          <b>24</b>
        </div>
        <div className="header-actions">
          <span className="local-status">
            <i /> Local workspace
          </span>
          <Button
            variant="ghost"
            onClick={() => {
              setFolderDraft(folder);
              setFolderError("");
              setSettingsOpen(true);
            }}
          >
            <Settings2 size={16} />
            Settings
          </Button>
        </div>
      </header>
      <section className="workspace-heading">
        <div>
          <div className="eyebrow">FOOTBALL MANAGER 2024</div>
          <h1>Find your next difference-maker.</h1>
        </div>
        {snapshot && (
          <div className="save-date">
            <span className="eyebrow">IN-GAME DATE</span>
            <strong>{date(snapshot.gameDate)}</strong>
          </div>
        )}
      </section>
      <section className="save-bar" aria-label="Save library">
        <FolderOpen size={23} />
        <div className="save-choice">
          <label className="muted" htmlFor="save-game">
            Save game
          </label>
          <Picker
            label="Save game"
            options={saveOptions}
            value={selected}
            onChange={setSelected}
            placeholder={initializing ? "Finding saves…" : "Choose a save"}
            disabled={running}
          />
        </div>
        <div className="file-meta">
          {chosen ? (
            <>
              <strong>
                {size(chosen.size)} <span>·</span> {date(chosen.modified)}
              </strong>
              <span className={chosen.cached ? "cached" : "muted"}>
                {chosen.cached ? "Cached · ready to open" : "Not imported"}
              </span>
            </>
          ) : (
            <span className="muted">{saves.length ? "Choose a save file" : "No saves found"}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh saves"
          disabled={running}
          onClick={() => {
            setError("");
            void refresh().catch((e) => setError(errorText(e)));
          }}
        >
          <RefreshCw size={17} />
        </Button>
        <Button disabled={!chosen || running || starting} onClick={() => void importSave()}>
          {starting ? <LoaderCircle className="spin" size={16} /> : <Database size={16} />}{" "}
          {chosen?.cached ? "Open save" : "Read save"}
        </Button>
      </section>
      {running && job && (
        <section className="import-progress">
          <Progress value={job.progress}>
            <ProgressLabel>{job.message}</ProgressLabel>
            <ProgressValue />
          </Progress>
          <Button variant="outline" onClick={() => void cancelImport()}>
            Cancel import
          </Button>
        </section>
      )}
      {error && (
        <div className="message error" role="alert">
          {error}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      {notice && !error && <output className="notice">{notice}</output>}
      {snapshot?.stale && (
        <div className="message warning">
          This snapshot is out of date. Read the save again to refresh its players.
        </div>
      )}
      {snapshot?.warnings.map((w) => (
        <div className="message warning" key={w}>
          {w}
        </div>
      ))}
      <section className="search-layout">
        <Collapsible className="filters" open={moreFiltersOpen} onOpenChange={setMoreFiltersOpen}>
          <fieldset className="primary-filters" aria-label="Player filters" disabled={!snapshot}>
            <label htmlFor="player-query">
              Name or player ID
              <div className="search-input">
                <Search size={15} />
                <Input
                  id="player-query"
                  aria-label="Name or player ID"
                  value={filters.q}
                  maxLength={200}
                  onChange={(e) => updateFilter("q", e.target.value)}
                  placeholder="Find a player…"
                />
              </div>
            </label>
            <div className="filter-field">
              <label htmlFor="club">Club</label>
              <Picker
                label="Club"
                options={clubOptions}
                value={filters.club}
                onChange={(v) => updateFilter("club", v)}
                placeholder="All clubs"
                disabled={!snapshot}
              />
            </div>
            <div className="filter-field">
              <label htmlFor="nationality">Nationality</label>
              <Picker
                label="Nationality"
                options={nationOptions}
                value={filters.nation}
                onChange={(v) => updateFilter("nation", v)}
                placeholder="All nationalities"
                disabled={!snapshot}
              />
            </div>
            <PositionFilter positions={positions} value={selectedPositions(filters.position)}
              match={filters.positionMatch === 'or' ? 'or' : 'and'} disabled={!snapshot}
              onChange={changePositions} />
            <div className="filter-field">
              <label htmlFor="role-and-duty">Role and duty</label>
              <Picker label="Role and duty" options={roleOptions} value={filters.role}
                onChange={changeRole} placeholder="Choose a role" disabled={!snapshot || !roleCatalog} />
            </div>
            <div className="filter-actions">
              <CollapsibleTrigger render={<Button variant="outline" />}>
                <SlidersHorizontal size={14} /> More filters
                {advancedFilters > 0 && <span className="filter-count" aria-label={`${advancedFilters} active advanced filters`}>{advancedFilters}</span>}
              </CollapsibleTrigger>
              <Button variant="ghost" size="sm" onClick={clearFilters} disabled={!activeFilters}>Reset</Button>
            </div>
          </fieldset>
          <CollapsibleContent>
            <fieldset className="advanced-filters" aria-label="More player filters" disabled={!snapshot}>
              <div className="filter-field">
                <label htmlFor="role-minimum">Minimum role rating / 100</label>
                <Input id="role-minimum" type="number" min={0} max={100} step="0.1"
                  placeholder="Any rating" value={filters.roleMin} disabled={!filters.role}
                  onChange={e => updateFilter("roleMin", e.target.value)} />
              </div>
              {[
                ["age", "Age", 120],
                ["ca", "Current ability", 200],
                ["pa", "Potential ability", 200],
              ].map(([key, label, max]) => (
                <div className="range-field" key={key}>
                  <span className="filter-label">{label}</span>
                  <div className="range-inputs">
                    <Input
                      aria-label={`${label} minimum`}
                      type="number"
                      min={0}
                      max={max}
                      placeholder="Min"
                      value={filters[key + "Min"]}
                      onChange={(e) => updateFilter(key + "Min", e.target.value)}
                    />
                    <span>–</span>
                    <Input
                      aria-label={`${label} maximum`}
                      type="number"
                      min={0}
                      max={max}
                      placeholder="Max"
                      value={filters[key + "Max"]}
                      onChange={(e) => updateFilter(key + "Max", e.target.value)}
                    />
                  </div>
                </div>
              ))}
              <PositionMatching value={selectedPositions(filters.position)}
                match={filters.positionMatch === 'or' ? 'or' : 'and'} disabled={!snapshot}
                onChange={changePositions} />
              <div className="attribute-filter">
                <div className="section-heading">MINIMUM ATTRIBUTES</div>
                <Picker
                  label="Attribute to filter"
                  options={attrOptions}
                  value={attributeKey}
                  onChange={setAttributeKey}
                  placeholder="Choose an attribute"
                  disabled={!snapshot}
                />
                <div className="attribute-add">
                  <Input
                    aria-label="Minimum attribute rating"
                    type="number"
                    min={1}
                    max={20}
                    value={attributeMin}
                    onChange={(e) => setAttributeMin(e.target.value)}
                  />
                  <span className="muted">/ 20</span>
                  <Button
                    variant="secondary"
                    aria-label="Add attribute filter"
                    disabled={
                      !attributeKey ||
                      !Number.isInteger(Number(attributeMin)) ||
                      Number(attributeMin) < 1 ||
                      Number(attributeMin) > 20
                    }
                    onClick={() => {
                      updateFilter("attr_" + attributeKey, attributeMin);
                      setAttributeKey("");
                    }}
                  >
                    <Plus size={15} />
                    Add
                  </Button>
                </div>
                <div className="attribute-chips">{attrFilters.map(([key, value]) => (
                  <div className="filter-chip" key={key}>
                    <span>
                      {attributes.find((a) => a.key === key.slice(5))?.label}{" "}
                      <strong>≥ {value}</strong>
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${attributes.find((a) => a.key === key.slice(5))?.label} filter`}
                      onClick={() => updateFilter(key, "")}
                    >
                      <X size={13} />
                    </Button>
                  </div>
                ))}</div>
              </div>
            </fieldset>
            <p className="filter-note">
              Selected filters work together. Attributes use 1–20; ability uses 1–200; role ratings are out of 100.
            </p>
          </CollapsibleContent>
        </Collapsible>
        <div className="results">
          <div className="results-heading">
            <div>
              <h2>
                Players {result && <span className="count">{result.total.toLocaleString()}</span>}
              </h2>
              <p className="muted">
                {snapshot
                  ? `${snapshot.sourceName} · ${snapshot.playerCount.toLocaleString()} players indexed`
                  : "Choose a save to explore its player database"}
              </p>
              {roleCatalog && <p className="selected-role-caption">{selectedRole ? `${roleLabel(selectedRole)} · ` : ''}{roleCatalog.systemName} · / 100</p>}
            </div>
            <div className="results-tools">
              <PlayerColumnChooser columns={availableColumns} selected={columnIds} onChange={changeColumns} disabled={!roleCatalog} />
              <output className="search-status">
              {showSearchSpinner && (
                <>
                  <LoaderCircle className="spin" size={14} /> {searchMessage}
                </>
              )}
              </output>
            </div>
          </div>
          {searchError ? (
            <div className="message error" role="alert">
              {searchError}
            </div>
          ) : (
            <>
              <div className="player-table" aria-busy={searching}>
                <PlayerListTable players={result?.players ?? []} columns={displayedColumns}
                  roles={roleCatalog?.roles ?? []}
                  sort={visibleSort(sort, filters.role)} direction={direction} onSort={changeSort} onOpen={openPlayer} />
              </div>
              {(!snapshot || (result && !result.players.length) || showSearchSpinner) && (
                <div className="empty-state">
                  {initializing || searching ? (
                    <LoaderCircle className="spin" size={30} />
                  ) : (
                    <Search size={32} />
                  )}
                  <h3>
                    {initializing
                      ? "Opening your workspace…"
                      : !snapshot
                        ? "Your next signing starts here"
                        : searching
                          ? searchMessage
                          : "No players match these filters"}
                  </h3>
                  <p>
                    {!snapshot
                      ? "Keep Football Manager closed, choose a save, then select Read save."
                      : !searching
                        ? "Try a wider ability range or remove an attribute filter."
                        : ""}
                  </p>
                  {snapshot && !searching && (
                    <Button variant="outline" onClick={clearFilters}>
                      Reset filters
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
          {snapshot && result && result.total > 0 && (
            <div className="results-footer">
              <span className="muted">
                {((page - 1) * Number(limit) + 1).toLocaleString()}–
                {Math.min(page * Number(limit), result.total).toLocaleString()} of{" "}
                {result.total.toLocaleString()}
              </span>
              <div className="paging">
                <Choice
                  label="Players per page"
                  value={limit}
                  options={["25", "50", "100", "250"].map((n) => ({
                    value: n,
                    label: n + " / page",
                  }))}
                  onChange={(v) => {
                    setLimit(v);
                    setPage(1);
                  }}
                />
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label="Previous page"
                        disabled={page <= 1 || searching}
                        onClick={() => setPage((p) => p - 1)}
                      >
                        <ChevronLeft size={16} />
                      </Button>
                    </PaginationItem>
                    <PaginationItem>
                      <span className="page-number">
                        {page} / {pages}
                      </span>
                    </PaginationItem>
                    <PaginationItem>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label="Next page"
                        disabled={page >= pages || searching}
                        onClick={() => setPage((p) => p + 1)}
                      >
                        <ChevronRight size={16} />
                      </Button>
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </div>
          )}
        </div>
      </section>
      <footer className="app-footer">
        <span>
          FM SAVELENS 24 <span>·</span> Private, local scouting
        </span>
        <span>Save files are read only</span>
      </footer>

      <RatingSystemSettings open={settingsOpen} onOpenChange={setSettingsOpen} attributes={attributes} onCatalog={applyRoleCatalog}>
          <label className="settings-label" htmlFor="save-folder-path">
            Save folder
            <Input
              id="save-folder-path"
              aria-label="Save folder"
              value={folderDraft}
              onChange={(e) => setFolderDraft(e.target.value)}
            />
          </label>
          <p className="muted">
            Extracted data is cached locally in your app data folder. No account or running
            game is needed.
          </p>
          {folderError && (
            <p className="error-text" role="alert">
              {folderError}
            </p>
          )}
          <Button
            disabled={running || savingFolder || !folderDraft.trim()}
            onClick={() => void saveFolder()}
          >
            {savingFolder ? "Saving…" : "Save folder"}
          </Button>
          {running && <p className="muted">Wait for the current import before changing folders.</p>}
      </RatingSystemSettings>
      <Sheet
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <SheetContent
          className="player-sheet"
          style={{ width: "min(830px, 100vw)", maxWidth: "none" }}
        >
          <SheetHeader>
            <div className="eyebrow">PLAYER PROFILE</div>
            <SheetTitle className="detail-name">{detail?.name ?? "Loading player…"}</SheetTitle>
            <SheetDescription>
              {detail
                ? `${detail.club ?? "Club unavailable"} · ${detail.positions.join(", ")} · ${detail.age} years old`
                : "Reading player details from your local snapshot."}
            </SheetDescription>
          </SheetHeader>
          {detailError ? (
            <div className="message error" role="alert">
              {detailError}
            </div>
          ) : !detail ? (
            <div className="empty-state">
              <LoaderCircle className="spin" />
            </div>
          ) : (
            <div className="detail-body">
              <div className="detail-summary">
                <div>
                  <span>Current ability</span>
                  <strong>
                    {detail.ca}
                    <small> / 200</small>
                  </strong>
                </div>
                <div>
                  <span>Potential ability</span>
                  <strong className="lime">
                    {detail.pa}
                    <small> / 200</small>
                  </strong>
                </div>
                <div>
                  <span>Born</span>
                  <b>{date(detail.birthDate)}</b>
                  <span>{detail.nationalities.join(" · ")}</span>
                </div>
              </div>
              <div className="detail-position">
                <span>Positions</span>
                {detail.positionRatings.map(
                  (v, i) =>
                    v >= 10 && (
                      <span className="position-chip" key={i}>
                        {positions[i]} <b>{v}</b>
                      </span>
                    ),
                )}
              </div>
              <Tabs key={JSON.stringify([detailKey, detailRole])} defaultValue={detailRole ? "roles" : "attributes"} className="profile-tabs">
                <TabsList aria-label="Player information">
                  <TabsTrigger value="attributes">Attributes</TabsTrigger>
                  <TabsTrigger value="roles">Role ratings</TabsTrigger>
                </TabsList>
                <TabsContent value="roles">
                  <RoleRatings key={systemKey} player={detail} roles={roleCatalog?.roles ?? []} attributes={attributes} initialRoleId={detailRole} systemName={roleCatalog?.systemName ?? ''} systemId={roleCatalog?.systemId ?? ''} />
                </TabsContent>
                <TabsContent value="attributes">
              <div className="attribute-groups">
                {groups.map((group) => (
                  <section className="attribute-group" key={group}>
                    <h3>
                      {group}
                      <small> / 20</small>
                    </h3>
                    {attributes
                      .filter((a) => a.group === group)
                      .sort((a, b) => a.label.localeCompare(b.label))
                      .map((a) => (
                        <div className="attribute-row" key={a.key}>
                          <span>
                            {a.label}
                            {a.inverted && (
                              <small title="A lower value is generally preferable"> ↓</small>
                            )}
                          </span>
                          <strong className={ratingClass(detail.attributes[a.key])}>
                            {detail.attributes[a.key] ?? "—"}
                          </strong>
                        </div>
                      ))}
                  </section>
                ))}
              </div>
              <p className="detail-note">
                ↓ Lower is generally preferable. A dash means unavailable. Position ratings below 10
                are omitted from this summary.
              </p>
                </TabsContent>
              </Tabs>
              <p className="detail-id">
                Player ID {detail.uid} <span>·</span> {snapshot?.sourceName}
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}
