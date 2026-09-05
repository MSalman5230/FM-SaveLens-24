mod support;
use fm_savelens_backend::{
    parser::{archive::Archive, parse_save, CATALOG, PARSER_VERSION},
    service, storage,
};
use serde_json::json;
use std::fs;
use tokio_util::sync::CancellationToken;

#[test]
fn snapshot_metadata_preserves_fractional_source_timestamps() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("timestamp.fm");
    support::archive(&path, false, "24.3.0+0", 64);
    let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
    // This timestamp loses precision with serde_json's default f64 deserializer.
    let modified = std::time::UNIX_EPOCH + std::time::Duration::new(1_788_551_603, 590_001_300);
    file.set_times(fs::FileTimes::new().set_modified(modified))
        .unwrap();
    let stat = file.metadata().unwrap();
    let source_mtime = service::mtime(&stat).unwrap();
    let cancel = CancellationToken::new();
    let save = parse_save(&path, &cancel, |_, _| {}).unwrap();
    let dbpath = dir.path().join("snapshot.sqlite");
    storage::create_snapshot(
        &dbpath,
        &save,
        json!({
            "sourcePath": path,
            "sourceSize": stat.len(),
            "sourceMtime": source_mtime,
            "parserVersion": PARSER_VERSION,
        }),
        &cancel,
    )
    .unwrap();
    let db = storage::open_snapshot(&dbpath).unwrap();
    let meta = storage::metadata(&db).unwrap();
    assert_eq!(meta["sourceMtime"].as_f64(), Some(source_mtime));
    assert_eq!(meta["stale"], false, "{meta}");

    // A timestamp-only change must still invalidate the snapshot at the same size.
    file.set_times(
        fs::FileTimes::new().set_modified(modified + std::time::Duration::from_millis(1)),
    )
    .unwrap();
    assert_eq!(file.metadata().unwrap().len(), stat.len());
    assert_eq!(storage::metadata(&db).unwrap()["stale"], true);
}

#[test]
fn compressed_and_plain_records_match_and_query_correctly() {
    let dir = tempfile::tempdir().unwrap();
    let cancel = CancellationToken::new();
    let mut variants = vec![];
    for compressed in [false, true] {
        let path = dir.path().join(format!("{compressed}.fm"));
        support::archive(&path, compressed, "24.3.0+0", 64);
        let before = fs::read(&path).unwrap();
        let save = parse_save(&path, &cancel, |_, _| {}).unwrap();
        assert_eq!(save.players.len(), 64);
        assert_eq!(save.players[0].name, "Álvaro García");
        assert_eq!(save.players[0].uid, 2_000_000_000);
        assert_eq!(save.players[0].ca, 200);
        assert_eq!(save.players[0].pa, 199);
        assert_eq!(save.players[0].birth_date, "2000-02-29");
        assert_eq!(save.players[0].age, 24);
        assert_eq!(save.players[0].other_nation_ids, vec![12]);
        assert_eq!(save.players[0].positions, vec!["ST"]);
        assert_eq!(save.players[0].attributes.len(), 62);
        for a in &CATALOG.attributes {
            assert_eq!(
                save.players[0].attributes[&a.key],
                if a.scale == 5 { 13 } else { 10 }
            );
        }
        assert_eq!(save.clubs.len(), 1);
        assert!(save.players[0].club.is_none());
        assert_eq!(save.diagnostics["ambiguous"], 0);
        assert_eq!(save.diagnostics["unbound"], 0);
        assert_eq!(fs::read(&path).unwrap(), before);
        let dbpath = dir.path().join(format!("{compressed}.sqlite"));
        storage::create_snapshot(&dbpath, &save, json!({}), &cancel).unwrap();
        let db = storage::open_snapshot(&dbpath).unwrap();
        let first = storage::search(
            &db,
            "q=alvaro&nation=12&position=12&attr_pace=13&caMin=200&paMax=199&limit=25",
        )
        .unwrap();
        assert_eq!(first["total"], 64);
        assert_eq!(first["players"].as_array().unwrap().len(), 25);
        let second = storage::search(&db, "limit=25&page=2").unwrap();
        assert_ne!(first["players"][0]["id"], second["players"][0]["id"]);
        assert_eq!(storage::search(&db, "q=%25").unwrap()["total"], 0);
        assert_eq!(storage::search(&db, "club=-1").unwrap()["total"], 64);
        for q in [
            "paMin=201",
            "ageMin=30&ageMax=15",
            "sort=invalid",
            "direction=sideways",
            "limit=0",
            "attr_pace=21",
        ] {
            assert!(storage::search(&db, q).is_err(), "{q}");
        }
        assert_eq!(storage::player(&db, 99999).unwrap_err().code, "NOT_FOUND");
        variants.push(serde_json::to_value(&save.players).unwrap());
    }
    assert_eq!(variants[0], variants[1]);
}
#[test]
fn malformed_and_unsupported_archives_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let cancel = CancellationToken::new();
    let path = dir.path().join("bad.fm");
    for size in [0, 6, 25, 26, 100] {
        fs::write(&path, vec![0; size]).unwrap();
        assert!(Archive::open(&path, &cancel).is_err());
    }
    support::archive(&path, true, "23.4.0+0", 1);
    assert_eq!(
        parse_save(&path, &cancel, |_, _| {}).err().unwrap().code,
        "UNSUPPORTED_VERSION"
    );
    support::write_archive(&path, false, vec![("game_db", vec![0; 40])]);
    assert_eq!(
        parse_save(&path, &cancel, |_, _| {}).err().unwrap().code,
        "MISSING_MEMBER"
    );
    support::archive(&path, false, "24.3.0+0", 1);
    let mut bytes = fs::read(&path).unwrap();
    bytes[9..17].fill(255);
    fs::write(&path, &bytes).unwrap();
    assert_eq!(
        Archive::open(&path, &cancel).err().unwrap().code,
        "INVALID_SIZE"
    );
}
#[test]
fn foreign_ability_ownership_is_excluded_and_sorting_is_directional() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ownership.fm");
    let mut database = support::database(64);
    let first_block = database.len() - 64 * 512;
    database[first_block..first_block + 4].copy_from_slice(&9999u32.to_le_bytes());
    // Give the second player a different CA so sorting has a meaningful result.
    database[first_block + 512 + 19] = 100;
    let mut info = vec![0; 32];
    info[12..20].copy_from_slice(b"24.3.0+0");
    support::write_archive(
        &path,
        false,
        vec![("game_info", info), ("game_db", database)],
    );
    let cancel = CancellationToken::new();
    let save = parse_save(&path, &cancel, |_, _| {}).unwrap();
    assert_eq!(save.players.len(), 63);
    assert!(!save.players.iter().any(|p| p.id == 1));
    assert_eq!(save.players.iter().find(|p| p.id == 2).unwrap().ca, 100);
    let dbpath = dir.path().join("snapshot.sqlite");
    storage::create_snapshot(&dbpath, &save, json!({}), &cancel).unwrap();
    let db = storage::open_snapshot(&dbpath).unwrap();
    assert_eq!(
        storage::search(&db, "sort=ca&direction=asc").unwrap()["players"][0]["id"],
        2
    );
    assert_ne!(
        storage::search(&db, "sort=ca&direction=desc").unwrap()["players"][0]["id"],
        2
    );
}
#[test]
fn cancellation_and_changed_source_never_produce_success() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("save.fm");
    support::archive(&path, true, "24.3.0+0", 2000);
    let cancel = CancellationToken::new();
    let result = parse_save(&path, &cancel, |progress, _| {
        if progress >= 35 {
            cancel.cancel()
        }
    });
    assert_eq!(result.err().unwrap().code, "CANCELLED");
    let cancel = CancellationToken::new();
    let result = parse_save(&path, &cancel, |progress, _| {
        if progress == 52 {
            let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
            file.set_len(file.metadata().unwrap().len() + 1).unwrap();
        }
    });
    assert_eq!(result.err().unwrap().code, "SAVE_CHANGED");
}
