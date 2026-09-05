use super::*;
use crate::rating_systems::{BUILTIN_ID, DEFAULT_ID};
use std::sync::mpsc;
use std::time::Duration;

#[test]
fn rating_persistence_allows_reads_and_serializes_concurrent_writers() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    std::thread::scope(|scope| {
        let app = &app;
        let first = scope.spawn(move || {
            app.commit_ratings(
                false,
                |next| {
                    next.create(&json!({"name":"First"}))?;
                    Ok(())
                },
                |next| {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    next.persist(&app.data)
                },
            )
        });
        entered_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let (read_tx, read_rx) = mpsc::channel();
        scope.spawn(move || {
            let settings = app.api("GET", "/api/settings", "", Value::Null);
            let library = app.api("GET", "/api/rating-systems", "", Value::Null);
            read_tx.send((settings, library)).unwrap();
        });
        let read = read_rx.recv_timeout(Duration::from_secs(10));
        // Always release the writer before asserting, so a regression cannot hang the test.
        release_tx.send(()).unwrap();
        let (settings, library) = read.unwrap();
        assert_eq!(settings.unwrap().0, 200);
        assert_eq!(library.unwrap().1["systems"].as_array().unwrap().len(), 2);
        first.join().unwrap().unwrap();
    });

    let barrier = std::sync::Barrier::new(8);
    std::thread::scope(|scope| {
        for i in 0..8 {
            let barrier = &barrier;
            let app = &app;
            scope.spawn(move || {
                barrier.wait();
                app.change_ratings(|next| next.create(&json!({"name":format!("Concurrent {i}")})))
                    .unwrap();
            });
        }
    });
    let saved = RatingStore::load(dir.path()).unwrap();
    assert_eq!(saved.systems.len(), 9);
    assert_eq!(saved.list(), app.inner.lock().unwrap().ratings.list());
}

#[test]
fn failed_writes_preserve_memory_disk_and_search_context() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    app.change_ratings(|next| next.activate(DEFAULT_ID))
        .unwrap();
    let before = fs::read(app.data.join("rating-systems.json")).unwrap();
    let session = Arc::new(Mutex::new(None));
    *app.searches.lock().unwrap() = Some(SearchContext {
        snapshot: "test".into(),
        system_id: DEFAULT_ID.into(),
        revision: 1,
        session: session.clone(),
    });
    let failed = app.commit_ratings(
        false,
        |next| next.activate(BUILTIN_ID),
        |_| Err(Error::new("IO", "Simulated write failure")),
    );
    assert_eq!(failed.unwrap_err().code, "IO");
    assert_eq!(
        app.inner.lock().unwrap().ratings.active_system_id,
        DEFAULT_ID
    );
    assert_eq!(
        fs::read(app.data.join("rating-systems.json")).unwrap(),
        before
    );
    assert!(Arc::ptr_eq(
        &session,
        &app.searches.lock().unwrap().as_ref().unwrap().session
    ));
    app.change_ratings(|next| next.activate(BUILTIN_ID))
        .unwrap();
    assert!(app.searches.lock().unwrap().is_none());
}

#[test]
fn failed_recovery_persistence_keeps_the_original_and_recovery_state() {
    let dir = tempfile::tempdir().unwrap();
    let original = b"invalid rating file";
    fs::write(dir.path().join("rating-systems.json"), original).unwrap();
    let app = AppState::open(dir.path()).unwrap();
    assert!(app
        .recover_ratings(|_| Err(Error::new("IO", "Write failed")))
        .is_err());
    assert!(app.inner.lock().unwrap().rating_recovery.is_some());
    assert_eq!(
        fs::read(dir.path().join("rating-systems.json")).unwrap(),
        original
    );
    let backups: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("rating-systems.backup-")
        })
        .collect();
    assert_eq!(backups.len(), 1);
    assert_eq!(fs::read(&backups[0]).unwrap(), original);
}

#[test]
fn concurrent_revision_updates_allow_exactly_one_winner() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    let system = app
        .change_ratings(|next| next.create(&json!({"name":"Original"})))
        .unwrap();
    let barrier = std::sync::Barrier::new(2);
    let results = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..2)
            .map(|i| {
                let app = &app;
                let barrier = &barrier;
                let id = &system.id;
                scope.spawn(move || {
                    barrier.wait();
                    app.change_ratings(|next| {
                        next.update(id, &json!({"name":format!("Edit {i}"), "revision":1}))
                    })
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .find_map(|result| result.as_ref().err())
            .unwrap()
            .code,
        "CONFLICT"
    );
    assert_eq!(
        RatingStore::load(dir.path())
            .unwrap()
            .find(&system.id)
            .unwrap()
            .revision,
        2
    );
}
