use super::*;
use std::sync::atomic::Ordering;

fn source(app: &AppState, id: &str) {
    let db = rusqlite::Connection::open(app.data.join("snapshots").join(format!("{id}.sqlite")))
        .unwrap();
    let attributes = crate::parser::CATALOG
        .attributes
        .iter()
        .map(|a| format!("15 AS attr_{}", a.key))
        .collect::<Vec<_>>()
        .join(",");
    db.execute_batch(&format!(
        "CREATE TABLE players AS SELECT
        1 AS id,2 AS uid,'Player' AS name,20 AS age,NULL AS club_id,NULL AS club,
        '[]' AS nations,'[]' AS positions,100 AS ca,150 AS pa,{attributes}"
    ))
    .unwrap();
}

#[test]
fn simultaneous_searches_prepare_once_and_context_changes_release_the_cache() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    let id = "a".repeat(64);
    source(&app, &id);
    let system = &crate::rating_systems::BUILTIN;
    let barrier = std::sync::Barrier::new(8);
    std::thread::scope(|scope| {
        for i in 0..8 {
            let app = &app;
            let id = &id;
            let barrier = &barrier;
            scope.spawn(move || {
                barrier.wait();
                let direction = if i % 2 == 0 { "asc" } else { "desc" };
                let result = app.search_players(id, &format!("sort=bestRoleRating&direction={direction}&bestRole=1&includeReversePage=1"), system).unwrap();
                assert_eq!(result["players"], result["reversePage"]["players"]);
            });
        }
    });
    assert_eq!(app.search_preparations.load(Ordering::Relaxed), 1);
    let previous = {
        let context = app.searches.lock().unwrap();
        let session = &context.as_ref().unwrap().session;
        assert_eq!(session.lock().unwrap().as_ref().unwrap().sort_builds(), 1);
        Arc::downgrade(session)
    };
    app.retain_rating_cache(system);
    assert!(previous.upgrade().is_some());
    let mut revised = (**system).clone();
    revised.revision += 1;
    app.retain_rating_cache(&revised);
    assert!(previous.upgrade().is_none());
    app.search_players(&id, "sort=bestRoleRating", &revised)
        .unwrap();
    assert_eq!(app.search_preparations.load(Ordering::Relaxed), 2);
    let other_id = "b".repeat(64);
    source(&app, &other_id);
    app.search_players(&other_id, "sort=bestRoleRating", &revised)
        .unwrap();
    assert_eq!(app.search_preparations.load(Ordering::Relaxed), 3);
    assert_eq!(
        app.searches.lock().unwrap().as_ref().unwrap().snapshot,
        other_id
    );
}

#[test]
fn failed_preparation_can_be_retried_after_the_source_is_fixed() {
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    let id = "c".repeat(64);
    // An incomplete database causes initialization to fail before publication.
    drop(
        rusqlite::Connection::open(app.data.join("snapshots").join(format!("{id}.sqlite")))
            .unwrap(),
    );
    assert!(app
        .search_players(&id, "", &crate::rating_systems::BUILTIN)
        .is_err());
    assert_eq!(app.search_preparations.load(Ordering::Relaxed), 0);
    source(&app, &id);
    app.search_players(&id, "", &crate::rating_systems::BUILTIN)
        .unwrap();
    assert_eq!(app.search_preparations.load(Ordering::Relaxed), 1);
}
