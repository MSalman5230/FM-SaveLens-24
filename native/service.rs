use crate::{
    parser::{self, archive::check, PARSER_VERSION},
    rating_systems::RatingStore,
    storage, Error, Result, APP_ID, VERSION,
};
use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
    Router,
};
use chrono::{DateTime, Utc};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, Metadata, OpenOptions},
    io::Write,
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, RwLock},
    time::{Instant, UNIX_EPOCH},
};
use tokio::{net::TcpListener, task::JoinHandle};
use tokio_util::sync::CancellationToken;

#[derive(rust_embed::RustEmbed)]
#[folder = "web/dist/client/"]
struct Assets;

/// Keep only a successful recovery's backup. The operation owns the file so
/// its handles are closed before best-effort cleanup, including on Windows.
fn with_recovery_backup<T>(path: &Path, operation: impl FnOnce(File) -> Result<T>) -> Result<T> {
    let file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = operation(file);
    if result.is_err() {
        let _ = fs::remove_file(path);
    }
    result
}

pub fn mtime(stat: &Metadata) -> Result<f64> {
    Ok(stat
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_err(|_| Error::new("IO", "Unsupported file timestamp."))?
        .as_secs_f64()
        * 1000.0)
}
fn digest(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
pub fn default_data_dir() -> PathBuf {
    std::env::var_os("FM_SAVELENS_24_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join(APP_ID)
        })
}
fn default_folder() -> String {
    dirs::document_dir()
        .map(|p| p.join("Sports Interactive/Football Manager 2024/games"))
        .filter(|p| p.is_dir())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}
fn canonical(path: &Path) -> Result<PathBuf> {
    let path = fs::canonicalize(path)?;
    // Keep ordinary drive paths in the API and migration settings on Windows.
    #[cfg(windows)]
    {
        let s = path.to_string_lossy();
        if let Some(p) = s.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{p}")));
        }
        if let Some(p) = s.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(p));
        }
    }
    Ok(path)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    folder: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_snapshot: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveFile {
    id: String,
    name: String,
    size: u64,
    mtime: f64,
    modified: String,
    snapshot_id: String,
    cached: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    save_id: String,
    snapshot_id: String,
    status: String,
    progress: u8,
    message: String,
    started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    player_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    elapsed_ms: Option<u128>,
}
type Completion = Arc<(Mutex<bool>, Condvar)>;
#[derive(Clone)]
struct Active {
    id: String,
    cancel: CancellationToken,
    done: Completion,
}
struct Inner {
    settings: Settings,
    ratings: RatingStore,
    rating_recovery: Option<String>,
    jobs: BTreeMap<String, Job>,
    active: Option<Active>,
    shutting_down: bool,
    cache_revision: String,
}
impl Inner {
    fn rating_library(&self) -> Value {
        let mut library = self.ratings.list();
        if let Some(message) = &self.rating_recovery {
            library["recovery"] = json!({"message": message});
        }
        library
    }
}
pub struct AppState {
    data: PathBuf,
    inner: Mutex<Inner>,
    rating_writer: Mutex<()>,
    searches: Mutex<Option<SearchContext>>,
    cache_gate: RwLock<()>,
    cache_clear: Mutex<()>,
    #[cfg(test)]
    search_preparations: std::sync::atomic::AtomicUsize,
    _lock: File,
}
struct SearchContext {
    snapshot: String,
    system_id: String,
    revision: u64,
    session: Arc<Mutex<Option<storage::SearchSession>>>,
}
mod cache;
#[cfg(test)]
mod cache_tests;
#[cfg(test)]
mod rating_tests;
#[cfg(test)]
mod search_tests;

impl AppState {
    pub fn open(data: &Path) -> Result<Arc<Self>> {
        fs::create_dir_all(data)?;
        let data = canonical(data)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(data.join("app.lock"))?;
        lock.try_lock_exclusive().map_err(|_|Error::new("ALREADY_RUNNING","FM SaveLens 24 is already using this data directory. Close it before starting another instance."))?;
        fs::create_dir_all(data.join("snapshots"))?;
        for entry in fs::read_dir(data.join("snapshots"))? {
            let entry = entry?;
            if entry.file_type()?.is_file()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".partial.sqlite")
            {
                fs::remove_file(entry.path())?;
            }
        }
        let settings_path = data.join("settings.json");
        let settings = if settings_path.exists() {
            serde_json::from_slice(&fs::read(&settings_path)?)?
        } else {
            let legacy = std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .map(|p| p.join("FM-SaveLens-24/settings.json"));
            let folder = legacy
                .and_then(|p| fs::read(p).ok())
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .and_then(|v| v["folder"].as_str().map(str::to_owned))
                .unwrap_or_else(default_folder);
            Settings {
                folder,
                last_snapshot: None,
            }
        };
        let (ratings, rating_recovery) = match RatingStore::load(&data) {
            Ok(ratings) => (ratings, None),
            Err(error) => (RatingStore::default(), Some(error.to_string())),
        };
        let app = Arc::new(Self {
            data,
            rating_writer: Mutex::new(()),
            searches: Mutex::new(None),
            cache_gate: RwLock::new(()),
            cache_clear: Mutex::new(()),
            #[cfg(test)]
            search_preparations: std::sync::atomic::AtomicUsize::new(0),
            inner: Mutex::new(Inner {
                settings,
                ratings,
                rating_recovery,
                jobs: BTreeMap::new(),
                active: None,
                shutting_down: false,
                cache_revision: uuid::Uuid::new_v4().to_string(),
            }),
            _lock: lock,
        });
        app.persist(&app.inner.lock().unwrap().settings)?;
        Ok(app)
    }
    fn persist(&self, settings: &Settings) -> Result<()> {
        let mut file = tempfile::NamedTempFile::new_in(&self.data)?;
        file.write_all(&serde_json::to_vec_pretty(settings)?)?;
        file.as_file().sync_all()?;
        file.persist(self.data.join("settings.json"))
            .map_err(|e| Error::from(e.error))?;
        Ok(())
    }
    /// Serialize rating writers without blocking workspace reads during disk I/O.
    /// Lock order is rating_writer, then inner, then searches; publication follows persistence.
    fn commit_ratings<T>(
        &self,
        recovering: bool,
        change: impl FnOnce(&mut RatingStore) -> Result<T>,
        persist: impl FnOnce(&RatingStore) -> Result<()>,
    ) -> Result<T> {
        let _writer = self.rating_writer.lock().unwrap();
        let mut next = {
            let inner = self.inner.lock().unwrap();
            if recovering {
                if inner.rating_recovery.is_none() {
                    return Err(Error::new(
                        "CONFLICT",
                        "Rating recovery is no longer required. Reload Settings.",
                    ));
                }
                RatingStore::default()
            } else {
                if inner.rating_recovery.is_some() {
                    return Err(Error::new("RECOVERY_REQUIRED", "Reset rating systems in Settings, or repair rating-systems.json and restart the app."));
                }
                inner.ratings.clone()
            }
        };
        let result = change(&mut next)?;
        persist(&next)?;
        let mut inner = self.inner.lock().unwrap();
        inner.ratings = next;
        inner.rating_recovery = None;
        self.retain_rating_cache(inner.ratings.active());
        Ok(result)
    }

    fn change_ratings<T>(&self, change: impl FnOnce(&mut RatingStore) -> Result<T>) -> Result<T> {
        self.commit_ratings(false, change, |next| next.persist(&self.data))
    }

    fn reset_ratings(&self) -> Result<Value> {
        self.recover_ratings(|next| next.persist(&self.data))
    }

    fn recover_ratings(&self, persist: impl FnOnce(&RatingStore) -> Result<()>) -> Result<Value> {
        let backup = format!("rating-systems.backup-{}.json", uuid::Uuid::new_v4());
        let mut library = self.commit_ratings(
            true,
            |next| Ok(next.list()),
            |next| {
                let mut original = File::open(self.data.join("rating-systems.json"))?;
                with_recovery_backup(&self.data.join(&backup), move |mut copy| {
                    std::io::copy(&mut original, &mut copy)?;
                    copy.sync_all()?;
                    // Windows replacement requires releasing the source handle first.
                    drop(original);
                    drop(copy);
                    persist(next)
                })
            },
        )?;
        library["backupFilename"] = json!(backup);
        Ok(library)
    }
    fn search_players(
        &self,
        snapshot: &str,
        query: &str,
        system: &crate::rating_systems::RatingSystem,
    ) -> Result<Value> {
        let path = self.db_path(snapshot)?;
        let session = {
            let mut context = self.searches.lock().unwrap();
            if context.as_ref().is_none_or(|context| {
                context.snapshot != snapshot
                    || context.system_id != system.id
                    || context.revision != system.revision
            }) {
                *context = Some(SearchContext {
                    snapshot: snapshot.into(),
                    system_id: system.id.clone(),
                    revision: system.revision,
                    session: Arc::new(Mutex::new(None)),
                });
            }
            context.as_ref().unwrap().session.clone()
        };
        // Serialize work only for this snapshot/rating context. Other API calls
        // and newly selected contexts remain responsive while ratings prepare.
        let mut session = session.lock().unwrap();
        if session.is_none() {
            *session = Some(storage::SearchSession::open(&path, system)?);
            #[cfg(test)]
            self.search_preparations
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        session.as_mut().unwrap().search(query)
    }
    fn retain_rating_cache(&self, system: &crate::rating_systems::RatingSystem) {
        let mut context = self.searches.lock().unwrap();
        if context.as_ref().is_some_and(|context| {
            context.system_id != system.id || context.revision != system.revision
        }) {
            context.take();
        }
    }
    fn list(&self, folder: &str) -> Result<Vec<SaveFile>> {
        if folder.is_empty() {
            return Ok(vec![]);
        }
        if !Path::new(folder).is_dir() {
            return Err(Error::query(
                "The save folder is unavailable. Choose an existing folder in Settings.",
            ));
        }
        let mut saves = vec![];
        for entry in fs::read_dir(folder)? {
            let entry = entry?;
            if !entry.file_type()?.is_file()
                || !entry
                    .path()
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("fm"))
            {
                continue;
            }
            let stat = entry.metadata()?;
            let modified = mtime(&stat)?;
            let path = entry.path().to_string_lossy().into_owned();
            let snapshot_id = digest(&format!(
                "{path}|{}|{modified}|{PARSER_VERSION}",
                stat.len()
            ));
            saves.push(SaveFile {
                id: digest(&path),
                name: entry.file_name().to_string_lossy().into_owned(),
                size: stat.len(),
                mtime: modified,
                modified: DateTime::<Utc>::from(stat.modified()?)
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                cached: self
                    .data
                    .join("snapshots")
                    .join(format!("{snapshot_id}.sqlite"))
                    .is_file(),
                snapshot_id,
            });
        }
        saves.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(saves)
    }
    fn db_path(&self, id: &str) -> Result<PathBuf> {
        if id.len() != 64
            || !id
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        {
            return Err(Error::query("Invalid snapshot."));
        }
        let path = self.data.join("snapshots").join(format!("{id}.sqlite"));
        if !path.is_file() {
            return Err(Error::query("This save has not been imported."));
        }
        Ok(path)
    }
    fn start_import(self: &Arc<Self>, save_id: &str) -> Result<Job> {
        let mut inner = self.inner.lock().unwrap();
        if inner.shutting_down {
            return Err(Error::new("SHUTTING_DOWN", "The app is shutting down."));
        }
        if inner.active.is_some() {
            return Err(Error::query(
                "Another save is already being read. Cancel it or wait for it to finish.",
            ));
        }
        let save = self
            .list(&inner.settings.folder)?
            .into_iter()
            .find(|s| s.id == save_id)
            .ok_or_else(|| {
                Error::query(
                    "The selected save is no longer in this folder. Refresh the save list.",
                )
            })?;
        let id = uuid::Uuid::new_v4().to_string();
        let job = Job {
            id: id.clone(),
            save_id: save_id.into(),
            snapshot_id: save.snapshot_id.clone(),
            status: if save.cached { "complete" } else { "running" }.into(),
            progress: if save.cached { 100 } else { 0 },
            message: if save.cached {
                "Loaded from local cache"
            } else {
                "Starting import"
            }
            .into(),
            started_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            player_count: None,
            elapsed_ms: None,
        };
        if inner.jobs.len() >= 100 {
            if let Some(key) = inner
                .jobs
                .values()
                .min_by_key(|j| &j.started_at)
                .map(|j| j.id.clone())
            {
                inner.jobs.remove(&key);
            }
        }
        if save.cached {
            let mut settings = inner.settings.clone();
            settings.last_snapshot = Some(save.snapshot_id);
            self.persist(&settings)?;
            inner.settings = settings;
        } else {
            let active = Active {
                id: id.clone(),
                cancel: CancellationToken::new(),
                done: Arc::new((Mutex::new(false), Condvar::new())),
            };
            inner.active = Some(active.clone());
            let file = Path::new(&inner.settings.folder).join(&save.name);
            let app = self.clone();
            if let Err(error) = std::thread::Builder::new()
                .name("save-import".into())
                .spawn(move || app.run_import(active, file, save))
            {
                inner.active = None;
                return Err(error.into());
            }
        }
        inner.jobs.insert(id, job.clone());
        Ok(job)
    }
    fn run_import(self: Arc<Self>, active: Active, file: PathBuf, save: SaveFile) {
        let start = Instant::now();
        let temporary = self
            .data
            .join("snapshots")
            .join(format!("{}.partial.sqlite", active.id));
        let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||->Result<usize>{
            check(&active.cancel)?;
            let before=fs::metadata(&file)?;
            if before.len()!=save.size || mtime(&before)?!=save.mtime{return Err(Error::new("SAVE_CHANGED","The save changed before import began. Refresh the save list and retry."))}
            let parsed=parser::parse_save(&file,&active.cancel,|progress,message|{let mut inner=self.inner.lock().unwrap();if let Some(job)=inner.jobs.get_mut(&active.id){job.progress=progress;job.message=message.into();}})?;
            storage::create_snapshot(&temporary,&parsed,json!({"snapshotId":save.snapshot_id,"sourcePath":file,"sourceName":save.name,"sourceSize":save.size,"sourceMtime":save.mtime,"parserVersion":PARSER_VERSION}),&active.cancel)?;
            let after=fs::metadata(&file)?;
            if after.len()!=before.len() || after.modified()?!=before.modified()? {return Err(Error::new("SAVE_CHANGED","The save changed during import. Wait for saving to finish and retry."))}
            // Serialize final publication with cancellation and settings changes.
            let mut inner=self.inner.lock().unwrap();check(&active.cancel)?;
            let destination=self.data.join("snapshots").join(format!("{}.sqlite",save.snapshot_id));
            fs::rename(&temporary,&destination)?;
            let mut settings=inner.settings.clone();settings.last_snapshot=Some(save.snapshot_id.clone());if let Err(error)=self.persist(&settings){fs::remove_file(&destination)?;return Err(error)}inner.settings=settings;
            let job=inner.jobs.get_mut(&active.id).unwrap();job.status="complete".into();job.progress=100;job.message="Ready".into();job.player_count=Some(parsed.players.len());job.elapsed_ms=Some(start.elapsed().as_millis());
            Ok(parsed.players.len())
        })).unwrap_or_else(|_|Err(Error::new("IMPORT_FAILED","The reader stopped unexpectedly.")));
        let cleanup = if temporary.exists() {
            fs::remove_file(&temporary)
        } else {
            Ok(())
        };
        {
            let mut inner = self.inner.lock().unwrap();
            if let Err(e) = result.and_then(|_| cleanup.map_err(Error::from)) {
                if let Some(job) = inner.jobs.get_mut(&active.id) {
                    job.status = if active.cancel.is_cancelled() {
                        "cancelled"
                    } else {
                        "error"
                    }
                    .into();
                    job.message = e.message;
                }
            }
            inner.active = None;
        }
        let (lock, done) = &*active.done;
        *lock.lock().unwrap() = true;
        done.notify_all();
    }
    fn cancel(&self, id: &str) -> Result<Job> {
        let active = {
            let inner = self.inner.lock().unwrap();
            if !inner.jobs.contains_key(id) {
                return Err(Error::new("NOT_FOUND", "Import not found."));
            }
            inner
                .active
                .as_ref()
                .filter(|a| a.id == id && inner.jobs[id].status == "running")
                .cloned()
                .inspect(|a| a.cancel.cancel())
        };
        if let Some(active) = active {
            wait_for(&active.done);
        }
        Ok(self.inner.lock().unwrap().jobs[id].clone())
    }
    pub fn stop_import(&self) {
        let active = self.inner.lock().unwrap().active.clone();
        if let Some(active) = active {
            active.cancel.cancel();
            wait_for(&active.done);
        }
    }
    fn begin_shutdown(&self) -> Option<Completion> {
        let mut inner = self.inner.lock().unwrap();
        // Use the import/publication mutex so no late request can start work
        // between capturing the active worker and stopping HTTP acceptance.
        inner.shutting_down = true;
        inner.active.as_ref().map(|active| {
            active.cancel.cancel();
            active.done.clone()
        })
    }
    fn api(
        self: &Arc<Self>,
        method: &str,
        path: &str,
        query: &str,
        body: Value,
    ) -> Result<(u16, Value)> {
        if method == "DELETE" && path == "/api/cache" {
            return Ok((200, self.clear_cache()?));
        }
        // Keep every request's snapshot handles alive only under a read lease.
        // Clearing holds the write lease, including during file deletion.
        let _cache_lease = self.cache_gate.read().unwrap();
        if path.starts_with("/api/snapshots/") || path.starts_with("/api/imports") {
            for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
                if key == "cacheRevision" && value != self.inner.lock().unwrap().cache_revision {
                    return Err(Error::new(
                        "CACHE_CHANGED",
                        "The cache was cleared. Read the save again.",
                    ));
                }
            }
        }
        match (method, path) {
            ("GET", "/api/cache") => Ok((200, self.cache_usage()?)),
            (_, "/api/health") => Ok((
                200,
                json!({"app":"fm24-scout","productName":"FM SaveLens 24","version":VERSION,"parserVersion":PARSER_VERSION}),
            )),
            ("GET", "/api/attributes") => Ok((200, serde_json::to_value(&*parser::CATALOG)?)),
            ("GET", "/api/roles") => {
                Ok((200, self.inner.lock().unwrap().ratings.active().catalog()))
            }
            ("GET", "/api/rating-systems") => {
                Ok((200, self.inner.lock().unwrap().rating_library()))
            }
            ("POST", "/api/rating-systems/reset") => Ok((200, self.reset_ratings()?)),
            ("POST", "/api/rating-systems") => {
                let system = self.change_ratings(|next| next.create(&body))?;
                Ok((201, json!(system)))
            }
            ("PUT", "/api/rating-systems/active") => {
                let library = self.change_ratings(|next| {
                    next.activate(body["systemId"].as_str().unwrap_or(""))?;
                    Ok(next.list())
                })?;
                Ok((200, library))
            }
            ("GET", "/api/settings") => {
                let inner = self.inner.lock().unwrap();
                let mut v = serde_json::to_value(&inner.settings)?;
                v["cacheRevision"] = json!(inner.cache_revision);
                v["activeJob"] = inner
                    .active
                    .as_ref()
                    .and_then(|a| inner.jobs.get(&a.id))
                    .map_or(Value::Null, |j| json!(j));
                Ok((200, v))
            }
            ("PUT", "/api/settings") => {
                let mut inner = self.inner.lock().unwrap();
                if inner.active.is_some() {
                    return Err(Error::query(
                        "Wait for the current import before changing folders.",
                    ));
                }
                let folder = body["folder"]
                    .as_str()
                    .filter(|s| s.len() <= 4096 && Path::new(s).is_dir())
                    .ok_or_else(|| Error::query("Choose an existing save folder."))?;
                let settings = Settings {
                    folder: canonical(Path::new(folder))?.to_string_lossy().into_owned(),
                    last_snapshot: None,
                };
                self.persist(&settings)?;
                inner.settings = settings.clone();
                self.searches.lock().unwrap().take();
                Ok((200, json!(settings)))
            }
            ("GET", "/api/saves") => {
                let folder = self.inner.lock().unwrap().settings.folder.clone();
                Ok((200, json!({"saves":self.list(&folder)?})))
            }
            ("POST", "/api/imports") => Ok((
                202,
                json!(self.start_import(body["saveId"].as_str().unwrap_or(""))?),
            )),
            _ => {
                let parts: Vec<_> = path.trim_start_matches('/').split('/').collect();
                if parts.len() == 3 && parts[1] == "rating-systems" {
                    if method == "GET" {
                        let inner = self.inner.lock().unwrap();
                        return Ok((200, json!(inner.ratings.find(parts[2])?)));
                    }
                    let result = self.change_ratings(|next| match method {
                        "PUT" => Ok(json!(next.update(parts[2], &body)?)),
                        "DELETE" => {
                            next.delete(parts[2])?;
                            Ok(next.list())
                        }
                        _ => Err(Error::new("NOT_FOUND", "Not found.")),
                    })?;
                    return Ok((200, result));
                }
                if parts.len() == 3 && parts[1] == "imports" {
                    if method == "DELETE" {
                        return Ok((200, json!(self.cancel(parts[2])?)));
                    }
                    if method == "GET" {
                        return self
                            .inner
                            .lock()
                            .unwrap()
                            .jobs
                            .get(parts[2])
                            .map(|j| (200, json!(j)))
                            .ok_or_else(|| Error::new("NOT_FOUND", "Import not found."));
                    }
                }
                if method == "GET"
                    && (3..=5).contains(&parts.len())
                    && parts[1] == "snapshots"
                    && (parts.len() == 3 || parts[3] == "players")
                {
                    let db = storage::open_snapshot(&self.db_path(parts[2])?)?;
                    if parts.len() == 3 {
                        let mut context = self.searches.lock().unwrap();
                        if context
                            .as_ref()
                            .is_some_and(|context| context.snapshot != parts[2])
                        {
                            context.take();
                        }
                        drop(context);
                        return Ok((200, storage::metadata(&db)?));
                    }
                    // One immutable definition per request, including SQL queries
                    // and response identity. Never hold the workspace lock during SQL.
                    let system = self.inner.lock().unwrap().ratings.active().clone();
                    if parts.len() > 3 {
                        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
                            if (key == "systemId" && value != system.id)
                                || (key == "systemRevision"
                                    && value.parse::<u64>().ok() != Some(system.revision))
                            {
                                return Err(Error::new(
                                    "CONFLICT",
                                    "The active rating system changed. Refresh ratings.",
                                ));
                            }
                        }
                    }
                    let result = match parts.len() {
                        4 => self.search_players(parts[2], query, &system)?,
                        _ => storage::player_with_system(
                            &db,
                            parts[4]
                                .parse()
                                .map_err(|_| Error::new("NOT_FOUND", "Player not found."))?,
                            &system,
                        )?,
                    };
                    return Ok((200, result));
                }
                Err(Error::new("NOT_FOUND", "Not found."))
            }
        }
    }
}
fn wait_for(completion: &Completion) {
    let (lock, done) = &**completion;
    let mut complete = lock.lock().unwrap();
    while !*complete {
        complete = done.wait(complete).unwrap();
    }
}
#[derive(Clone)]
struct HttpState {
    app: Arc<AppState>,
    port: u16,
}
fn json_response(status: u16, value: Value) -> Response {
    let mut response = (
        StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        axum::Json(value),
    )
        .into_response();
    response
        .headers_mut()
        .insert("Cache-Control", "no-store".parse().unwrap());
    response
        .headers_mut()
        .insert("X-Content-Type-Options", "nosniff".parse().unwrap());
    response
}
fn error_response(e: Error) -> Response {
    let status = match e.code.as_str() {
        "INVALID_QUERY" => 400,
        "CONFLICT" | "RECOVERY_REQUIRED" | "CACHE_CHANGED" => 409,
        "NOT_FOUND" => 404,
        "SHUTTING_DOWN" => 503,
        _ => 500,
    };
    let mut body = json!({"error":e.message});
    if matches!(e.code.as_str(), "RECOVERY_REQUIRED" | "CACHE_CHANGED") {
        body["code"] = json!(e.code);
    }
    json_response(status, body)
}
async fn handle(State(state): State<HttpState>, req: Request<Body>) -> Response {
    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let allowed_hosts = [
        format!("127.0.0.1:{}", state.port),
        format!("localhost:{}", state.port),
    ];
    if !allowed_hosts.iter().any(|allowed| allowed == host) {
        return json_response(403, json!({"error":"Invalid host."}));
    }
    if let Some(origin) = req.headers().get("origin") {
        let origin = origin.to_str().unwrap_or("");
        if origin != "http://127.0.0.1:5173"
            && !allowed_hosts
                .iter()
                .any(|host| origin == format!("http://{host}"))
        {
            return json_response(
                403,
                json!({"error":"This app accepts local workspace requests only."}),
            );
        }
    }
    let path = req.uri().path().to_string();
    let query = req.uri().query().unwrap_or("").to_string();
    let method = req.method().to_string();
    if path.starts_with("/api/") {
        let needs_body = (method == "PUT" && path == "/api/settings")
            || (matches!(method.as_str(), "POST" | "PUT")
                && (path == "/api/rating-systems" || path.starts_with("/api/rating-systems/")))
            || (method == "POST" && path == "/api/imports");
        let body = if needs_body {
            if !req
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .is_some_and(|s| s.starts_with("application/json"))
            {
                return json_response(400, json!({"error":"Expected JSON."}));
            }
            let body_limit = if path.starts_with("/api/rating-systems") {
                4 * 1024 * 1024
            } else {
                65536
            };
            match to_bytes(req.into_body(), body_limit).await {
                Ok(b) => match serde_json::from_slice::<Value>(&b) {
                    Ok(v) if v.is_object() => v,
                    _ => return json_response(400, json!({"error":"Expected a JSON object."})),
                },
                Err(_) => return json_response(400, json!({"error":"Request is too large."})),
            }
        } else {
            Value::Null
        };
        return match tokio::task::spawn_blocking(move || {
            state.app.api(&method, &path, &query, body)
        })
        .await
        {
            Ok(Ok((status, v))) => json_response(status, v),
            Ok(Err(e)) => error_response(e),
            Err(_) => json_response(500, json!({"error":"Request failed."})),
        };
    }
    if method != "GET" && method != "HEAD" {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let Ok(path) = percent_encoding::percent_decode_str(&path).decode_utf8() else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if path.contains('\\') || path.contains('\0') || path.split('/').any(|p| p == "..") {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut asset = path.trim_start_matches('/').to_string();
    if asset.is_empty() || asset.ends_with('/') {
        asset.push_str("index.html")
    }
    let resource = Assets::get(&asset).or_else(|| {
        if Path::new(&asset).extension().is_none() {
            asset = "index.html".into();
            Assets::get(&asset)
        } else {
            None
        }
    });
    let Some(resource) = resource else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let mut response = Response::builder()
        .status(200)
        .header(
            "Content-Type",
            mime_guess::from_path(&asset)
                .first_or_octet_stream()
                .as_ref(),
        )
        .header("X-Content-Type-Options", "nosniff")
        .header(
            "Cache-Control",
            if asset.ends_with(".html") {
                "no-cache"
            } else {
                "public, max-age=86400"
            },
        );
    response = response.header("Content-Length", resource.data.len());
    response
        .body(if method == "HEAD" {
            Body::empty()
        } else {
            Body::from(resource.data.into_owned())
        })
        .unwrap()
}
pub struct RunningServer {
    pub address: SocketAddr,
    pub app: Arc<AppState>,
    shutdown: CancellationToken,
    task: JoinHandle<std::io::Result<()>>,
}
impl RunningServer {
    pub fn url(&self) -> String {
        format!("http://{}", self.address)
    }
    pub async fn shutdown(self) -> Result<()> {
        let completion = self.app.begin_shutdown();
        self.shutdown.cancel();
        if let Some(completion) = completion {
            tokio::task::spawn_blocking(move || wait_for(&completion))
                .await
                .map_err(|e| Error::new("SHUTDOWN", e.to_string()))?;
        }
        self.task
            .await
            .map_err(|e| Error::new("SHUTDOWN", e.to_string()))??;
        Ok(())
    }
}
pub async fn start(port: u16, data: &Path) -> Result<RunningServer> {
    let app = AppState::open(data)?;
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    let address = listener.local_addr()?;
    let router = Router::new().fallback(handle).with_state(HttpState {
        app: app.clone(),
        port: address.port(),
    });
    let shutdown = CancellationToken::new();
    let cancel = shutdown.clone();
    let task = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(cancel.cancelled_owned())
            .await
    });
    Ok(RunningServer {
        address,
        app,
        shutdown,
        task,
    })
}
pub async fn run_browser(args: impl Iterator<Item = String>) -> Result<()> {
    let mut port = std::env::var("FM_SAVELENS_24_PORT")
        .unwrap_or_else(|_| "4242".into())
        .parse::<u16>()
        .map_err(|_| Error::query("Invalid FM_SAVELENS_24_PORT."))?;
    let mut no_open = false;
    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--browser" => {}
            "--no-open" => no_open = true,
            "--port" => {
                port = args
                    .next()
                    .ok_or_else(|| Error::query("--port needs a value."))?
                    .parse()
                    .map_err(|_| Error::query("Invalid port."))?
            }
            "--version" => {
                println!("FM SaveLens 24 {VERSION}");
                return Ok(());
            }
            "--help" => {
                println!("FM SaveLens 24 server [--port PORT] [--no-open]\nFM_SAVELENS_24_DATA_DIR overrides local storage. Stop with Ctrl+C.");
                return Ok(());
            }
            _ => return Err(Error::query(format!("Unknown option: {arg}"))),
        }
    }
    let server = start(port, &default_data_dir()).await?;
    println!("FM SaveLens 24: {}", server.url());
    println!(
        "{}",
        json!({"ready":true,"port":server.address.port(),"version":VERSION})
    );
    if !no_open {
        if let Err(e) = open::that_detached(server.url()) {
            eprintln!("Open {} in your browser: {e}", server.url());
        }
    }
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! {r=tokio::signal::ctrl_c()=>{r?},_=terminate.recv()=>{}}
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await?;
    server.shutdown().await
}
