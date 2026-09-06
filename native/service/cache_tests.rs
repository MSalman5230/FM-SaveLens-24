use super::*;

fn usage(app: &Arc<AppState>) -> Value {
    app.api("GET", "/api/cache", "", Value::Null).unwrap().1
}

#[test]
fn cache_counts_recognized_files_and_clears_memory_without_touching_preferences() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    let id = "a".repeat(64);
    let ratings = app
        .change_ratings(|store| store.create(&json!({"name": "My ratings"})))
        .unwrap();
    search_tests::source(&app, &id);
    app.search_players(&id, "sort=bestRoleRating", &crate::rating_systems::BUILTIN)
        .unwrap();
    let folder = app.data.join("snapshots");
    let partial = folder.join(format!("{}.partial.sqlite", uuid::Uuid::new_v4()));
    let sidecar = folder.join(format!("{id}.sqlite-journal"));
    fs::write(&partial, b"partial").unwrap();
    fs::write(&sidecar, b"journal").unwrap();
    fs::write(folder.join("keep.fm"), b"source save").unwrap();
    fs::write(folder.join("unrecognized.sqlite"), b"keep").unwrap();
    fs::create_dir(folder.join(format!("{}.sqlite", "b".repeat(64)))).unwrap();
    let rating_bytes = fs::read(app.data.join("rating-systems.json")).unwrap();
    let settings_before = app.inner.lock().unwrap().settings.clone();
    app.inner.lock().unwrap().settings.last_snapshot = Some(id.clone());
    let before = usage(&app);
    assert_eq!(before["snapshotCount"], 1);
    assert_eq!(
        before["diskBytes"],
        fs::metadata(folder.join(format!("{id}.sqlite")))
            .unwrap()
            .len()
            + 14
    );
    assert!(before["backendMemoryBytes"].as_u64().unwrap() > 0);
    let result = app.api("DELETE", "/api/cache", "", Value::Null).unwrap().1;
    assert_eq!(result["complete"], true);
    assert_eq!(result["removedBytes"], before["diskBytes"]);
    assert_eq!(result["removedCount"], 1);
    assert_eq!(result["usage"]["diskBytes"], 0);
    assert_eq!(result["usage"]["backendMemoryBytes"], 0);
    assert_ne!(result["usage"]["cacheRevision"], before["cacheRevision"]);
    assert!(app.searches.lock().unwrap().is_none());
    assert_eq!(fs::read(folder.join("keep.fm")).unwrap(), b"source save");
    assert!(folder.join("unrecognized.sqlite").is_file());
    assert_eq!(
        fs::read(app.data.join("rating-systems.json")).unwrap(),
        rating_bytes
    );
    assert!(app.inner.lock().unwrap().ratings.find(&ratings.id).is_ok());
    let settings = app.api("GET", "/api/settings", "", Value::Null).unwrap().1;
    assert!(settings.get("lastSnapshot").is_none());
    assert_eq!(settings["folder"], settings_before.folder);
    let stale = app
        .api(
            "GET",
            &format!("/api/snapshots/{id}/players"),
            &format!(
                "cacheRevision={}",
                before["cacheRevision"].as_str().unwrap()
            ),
            Value::Null,
        )
        .unwrap_err();
    assert_eq!(stale.code, "CACHE_CHANGED");
    assert_eq!(app.clear_cache().unwrap()["removedBytes"], 0);
}

#[test]
fn persistence_failure_and_active_import_leave_cache_intact() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    let id = "a".repeat(64);
    search_tests::source(&app, &id);
    app.search_players(&id, "sort=ca", &crate::rating_systems::BUILTIN)
        .unwrap();
    let before = usage(&app);
    fs::remove_file(app.data.join("settings.json")).unwrap();
    fs::create_dir(app.data.join("settings.json")).unwrap();
    assert!(app.clear_cache().is_err());
    assert_eq!(usage(&app), before);
    app.inner.lock().unwrap().active = Some(Active {
        id: "running".into(),
        cancel: CancellationToken::new(),
        done: Arc::new((Mutex::new(false), Condvar::new())),
    });
    assert_eq!(usage(&app)["canClear"], false);
    assert_eq!(app.clear_cache().unwrap_err().code, "CONFLICT");
    assert_eq!(usage(&app)["diskBytes"], before["diskBytes"]);
}

#[test]
fn deletion_failure_returns_remaining_usage_and_can_be_retried() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    let first = format!("{}.sqlite", "a".repeat(64));
    let second = format!("{}.sqlite", "b".repeat(64));
    fs::write(app.data.join("snapshots").join(&first), [1; 10]).unwrap();
    fs::write(app.data.join("snapshots").join(&second), [1; 20]).unwrap();
    let before = usage(&app);
    let result = app.clear_cache_failing_file(&first).unwrap();
    assert_eq!(result["complete"], false);
    assert_eq!(result["removedBytes"], 20);
    assert_eq!(result["usage"]["diskBytes"], 10);
    assert_eq!(result["failures"].as_array().unwrap().len(), 1);
    assert_ne!(result["usage"]["cacheRevision"], before["cacheRevision"]);
    assert_eq!(app.clear_cache().unwrap()["complete"], true);
}

#[test]
fn clearing_waits_for_readers_and_closes_their_database_handles() {
    use std::{sync::mpsc, time::Duration};
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    let id = "a".repeat(64);
    search_tests::source(&app, &id);
    let lease = app.cache_gate.read().unwrap();
    let db = storage::open_snapshot(&app.db_path(&id).unwrap()).unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::scope(|scope| {
        let app = &app;
        scope.spawn(move || {
            tx.send(app.clear_cache()).unwrap();
        });
        let blocked = rx.recv_timeout(Duration::from_millis(50));
        drop(db);
        drop(lease);
        assert!(matches!(blocked, Err(mpsc::RecvTimeoutError::Timeout)));
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap()["complete"],
            true
        );
    });
}

#[cfg(unix)]
#[test]
fn clearing_does_not_follow_snapshot_symlinks() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    let original = dir.path().join("original.fm");
    fs::write(&original, b"original").unwrap();
    let link = app
        .data
        .join("snapshots")
        .join(format!("{}.sqlite", "a".repeat(64)));
    std::os::unix::fs::symlink(&original, &link).unwrap();
    assert_eq!(usage(&app)["diskBytes"], 0);
    app.clear_cache().unwrap();
    assert!(link.is_symlink());
    assert_eq!(fs::read(original).unwrap(), b"original");
}
