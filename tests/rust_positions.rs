use fm_savelens_backend::{
    parser::{ParsedSave, Player, CATALOG},
    storage,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/position-filters.json")).unwrap()
}

fn snapshot() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let players = fixture()["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            let mut ratings = vec![0u8; CATALOG.positions.len()];
            for (index, rating) in row["ratings"].as_object().unwrap() {
                ratings[index.parse::<usize>().unwrap()] = rating.as_u64().unwrap() as u8;
            }
            serde_json::from_value::<Player>(json!({
                "id":row["id"], "uid":row["id"], "name":row["name"], "fullName":row["name"],
                "age":24, "birthDate":"2000-01-01", "nationId":1, "otherNationIds":[],
                "clubId":row["clubId"], "club":row["clubId"].as_u64().map(|id| format!("Club {id}")),
                "ca":100 + row["id"].as_u64().unwrap(), "pa":150,
                "positions":CATALOG.positions.iter().enumerate().filter(|(i, _)| ratings[*i] >= 15).map(|(_, p)| p).collect::<Vec<_>>(),
                "positionRatings":ratings,
                "attributes":CATALOG.attributes.iter().map(|a| (a.key.clone(), row["attribute"].clone())).collect::<serde_json::Map<_, _>>(),
                "rawAttributes":[], "source":{}
            })).unwrap()
        })
        .collect();
    let save = ParsedSave {
        name: "Position fixture".into(),
        format_version: "24.3.0+0".into(),
        game_date: "2024-01-01".into(),
        players,
        clubs: vec![],
        diagnostics: json!({}),
        warnings: vec![],
    };
    let path = dir.path().join("snapshot.sqlite");
    storage::create_snapshot(&path, &save, json!({}), &CancellationToken::new()).unwrap();
    let db = storage::open_snapshot(&path).unwrap();
    (dir, db)
}

fn ids(result: &Value) -> Value {
    result["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].clone())
        .collect()
}

#[test]
fn position_queries_match_shared_boundaries_validation_and_pagination() {
    let (_dir, db) = snapshot();
    let fixture = fixture();
    for sample in fixture["cases"].as_array().unwrap() {
        let query = sample["query"].as_str().unwrap();
        let result = storage::search(&db, &format!("{query}&sort=ca&direction=asc")).unwrap();
        assert_eq!(result["total"], sample["total"], "{query}");
        assert_eq!(ids(&result), sample["ids"], "{query}");
    }
    for query in fixture["invalid"].as_array().unwrap() {
        assert!(
            storage::search(&db, query.as_str().unwrap()).is_err(),
            "{query}"
        );
    }
    let descending = storage::search(
        &db,
        "position=2,4&positionMatch=or&sort=ca&direction=desc&limit=2&page=2",
    )
    .unwrap();
    assert_eq!(descending["total"], 5);
    assert_eq!(ids(&descending), json!([3, 2]));
    assert_eq!(storage::search(&db, "").unwrap()["total"], 8);
}

#[test]
fn positions_combine_with_club_attributes_and_role_ratings_before_counting() {
    let (_dir, db) = snapshot();
    let query = "position=2,4&club=1&attr_pace=16&role=cd-defend&roleMin=82&sort=roleRating";
    let and = storage::search(&db, query).unwrap();
    assert_eq!(and["total"], 0);
    let or = storage::search(&db, &format!("{query}&positionMatch=or")).unwrap();
    assert_eq!(or["total"], 1);
    assert_eq!(ids(&or), json!([2]));
    assert_eq!(or["players"][0]["roleRating"], 85.0);
    let query = "position=2,4&positionMatch=or&role=cd-defend&roleMin=80&sort=roleRating&limit=1";
    for (page, expected) in [(1, 5), (2, 2), (3, 1)] {
        let result = storage::search(&db, &format!("{query}&page={page}")).unwrap();
        assert_eq!(result["total"], 3);
        assert_eq!(ids(&result), json!([expected]));
    }
}
