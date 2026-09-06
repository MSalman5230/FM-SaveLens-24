use super::*;

struct CacheFile {
    path: PathBuf,
    bytes: u64,
    snapshot: bool,
}

fn recognized(name: &str) -> Option<bool> {
    let base = ["-journal", "-wal", "-shm"]
        .iter()
        .find_map(|suffix| name.strip_suffix(suffix))
        .unwrap_or(name);
    if let Some(id) = base.strip_suffix(".partial.sqlite") {
        return uuid::Uuid::parse_str(id).ok().map(|_| false);
    }
    let id = base.strip_suffix(".sqlite")?;
    (id.len() == 64
        && id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)))
    .then_some(base == name)
}

impl AppState {
    fn cache_files(&self) -> Result<Vec<CacheFile>> {
        let directory = self.data.join("snapshots");
        if !fs::symlink_metadata(&directory)?.file_type().is_dir() {
            return Err(Error::new(
                "IO",
                "The snapshot directory must be a regular directory.",
            ));
        }
        let mut files = Vec::new();
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            if let Some(snapshot) = recognized(&entry.file_name().to_string_lossy()) {
                files.push(CacheFile {
                    path: entry.path(),
                    bytes: entry.metadata()?.len(),
                    snapshot,
                });
            }
        }
        Ok(files)
    }

    pub(super) fn cache_usage(&self) -> Result<Value> {
        let files = self.cache_files()?;
        let inner = self.inner.lock().unwrap();
        let context = self.searches.lock().unwrap();
        let memory_bytes = match context.as_ref() {
            Some(context) => context
                .session
                .lock()
                .unwrap()
                .as_ref()
                .map_or(Ok(0), storage::SearchSession::memory_bytes)?,
            None => 0,
        };
        Ok(json!({
            "diskBytes": files.iter().map(|f| f.bytes).sum::<u64>(),
            "snapshotCount": files.iter().filter(|f| f.snapshot).count(),
            "backendMemoryBytes": memory_bytes,
            "cacheRevision": inner.cache_revision,
            "canClear": inner.active.is_none() && !inner.shutting_down,
        }))
    }

    pub(super) fn clear_cache(&self) -> Result<Value> {
        self.clear_cache_with(|path| fs::remove_file(path))
    }

    fn clear_cache_with(&self, remove: impl Fn(&Path) -> std::io::Result<()>) -> Result<Value> {
        let _clearing = self
            .cache_clear
            .try_lock()
            .map_err(|_| Error::new("CONFLICT", "Cache clearing is already in progress."))?;
        let _lease = self.cache_gate.write().unwrap();
        let mut inner = self.inner.lock().unwrap();
        if inner.active.is_some() || inner.shutting_down {
            return Err(Error::new(
                "CONFLICT",
                "Finish or cancel the current import before clearing the cache.",
            ));
        }
        // Inventory and persistence failures leave the current session intact.
        let files = self.cache_files()?;
        let mut settings = inner.settings.clone();
        settings.last_snapshot = None;
        self.persist(&settings)?;
        inner.settings = settings;
        inner.cache_revision = uuid::Uuid::new_v4().to_string();
        inner.jobs.clear();
        self.searches.lock().unwrap().take();
        drop(inner);

        let mut removed_bytes = 0;
        let mut removed_count = 0;
        let mut failures = Vec::new();
        for file in files {
            // Recheck regular-file status immediately before deletion; never follow links.
            let result = fs::symlink_metadata(&file.path).and_then(|metadata| {
                if !metadata.file_type().is_file() {
                    return Err(std::io::Error::other(
                        "Cache entry is no longer a regular file.",
                    ));
                }
                remove(&file.path)
            });
            match result {
                Ok(()) => {
                    removed_bytes += file.bytes;
                    removed_count += usize::from(file.snapshot);
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => failures.push(json!({
                    "file": file.path.file_name().unwrap().to_string_lossy(),
                    "error": error.to_string(),
                })),
            }
        }
        // The operation has committed even if the final inventory fails. Return its
        // revision so clients discard their old data, with unknown usage as null.
        let usage = match self.cache_usage() {
            Ok(usage) => usage,
            Err(error) => {
                failures.push(json!({"file": "snapshots", "error": error.to_string()}));
                json!({"diskBytes": null, "snapshotCount": null, "backendMemoryBytes": 0,
                    "cacheRevision": self.inner.lock().unwrap().cache_revision, "canClear": true})
            }
        };
        let complete = failures.is_empty() && usage["diskBytes"] == 0;
        Ok(
            json!({"usage": usage, "removedBytes": removed_bytes, "removedCount": removed_count,
            "complete": complete, "failures": failures}),
        )
    }

    #[cfg(test)]
    pub(super) fn clear_cache_failing_file(&self, name: &str) -> Result<Value> {
        self.clear_cache_with(|path| {
            if path.file_name().unwrap() == name {
                Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "Test deletion failure",
                ))
            } else {
                fs::remove_file(path)
            }
        })
    }
}
