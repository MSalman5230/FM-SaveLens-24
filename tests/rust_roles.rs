mod support;
use fm_savelens_backend::{
    parser::{parse_save, CATALOG},
    roles::{self, RoleCatalog, ROLES},
    storage,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{collections::BTreeSet, fs, path::PathBuf};
use tokio_util::sync::CancellationToken;

fn attributes(value: u8) -> Value {
    Value::Object(
        CATALOG
            .attributes
            .iter()
            .map(|a| (a.key.clone(), json!(value)))
            .collect(),
    )
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-10, "{a} != {b}");
}
fn set(values: &[String]) -> BTreeSet<&str> {
    values.iter().map(String::as_str).collect()
}

#[test]
fn catalog_is_complete_and_rejects_invalid_definitions() {
    roles::validate(&ROLES).unwrap();
    assert_eq!(ROLES.roles.len(), 85);
    assert_eq!(
        ROLES
            .roles
            .iter()
            .map(|r| &r.role)
            .collect::<BTreeSet<_>>()
            .len(),
        45
    );
    for (id, duty) in [
        ("ifb-defend", "defend"),
        ("lib-defend", "defend"),
        ("lib-support", "support"),
    ] {
        assert_eq!(roles::find(id).unwrap().duty, duty);
    }
    assert!(roles::find("lib-attack").is_err());
    assert!(roles::find("fb-automatic").is_err());
    let fresh =
        || serde_json::from_str::<RoleCatalog>(include_str!("../native/roles.json")).unwrap();
    let mut catalog = fresh();
    catalog.roles[0]
        .key_attributes
        .push("finishing);DROP TABLE players;--".into());
    assert!(roles::validate(&catalog).is_err());
    let mut catalog = fresh();
    let duplicate = catalog.roles[0].key_attributes[0].clone();
    catalog.roles[0].preferable_attributes.push(duplicate);
    assert!(roles::validate(&catalog).is_err());
    let mut catalog = fresh();
    catalog.roles[0].key_attributes.clear();
    assert!(roles::validate(&catalog).is_err());
    let mut catalog = fresh();
    catalog.key_weight = 3;
    assert!(roles::validate(&catalog).is_err());
}

#[test]
fn representative_profiles_match_the_researched_highlights() {
    let cases = [
        ("af-attack", "dribbling finishing firstTouch technique composure offTheBall acceleration", "passing anticipation decisions workRate agility balance pace stamina"),
        ("ap-support", "firstTouch passing technique composure decisions offTheBall teamwork vision", "dribbling anticipation flair agility"),
        ("cd-defend", "heading marking tackling positioning jumpingReach strength", "aggression anticipation bravery composure concentration decisions pace"),
        ("bpd-defend", "heading marking passing tackling composure positioning jumpingReach strength", "firstTouch technique aggression anticipation bravery concentration decisions vision pace"),
        ("w-support", "crossing dribbling technique acceleration agility", "firstTouch passing offTheBall workRate balance pace stamina"),
        ("if-attack", "dribbling finishing firstTouch technique anticipation offTheBall acceleration agility", "longShots passing composure flair workRate balance pace stamina"),
        ("ifb-defend", "heading marking tackling positioning strength", "dribbling firstTouch passing technique aggression anticipation bravery composure concentration decisions workRate agility jumpingReach pace"),
        ("lib-defend", "firstTouch heading marking passing tackling technique composure decisions positioning teamwork jumpingReach strength", "anticipation bravery concentration pace stamina"),
        ("gk-defend", "concentration positioning agility aerialReach commandOfArea communication handling kicking reflexes", "anticipation decisions oneOnOnes throwing"),
        ("sk-support", "anticipation composure concentration positioning agility commandOfArea kicking oneOnOnes reflexes rushingOut", "firstTouch passing decisions vision acceleration aerialReach communication handling throwing"),
    ];
    for (id, key, preferable) in cases {
        let role = roles::find(id).unwrap();
        assert_eq!(set(&role.key_attributes), key.split(' ').collect(), "{id}");
        assert_eq!(
            set(&role.preferable_attributes),
            preferable.split(' ').collect(),
            "{id}"
        );
    }
}

#[test]
fn scores_have_correct_scale_weights_and_ignore_unhighlighted_attributes() {
    for value in [1, 15, 20] {
        for role in &ROLES.roles {
            let result = role.rate(&attributes(value));
            assert_eq!(result.score, Some(f64::from(value) * 5.0));
            assert!(result.missing_attributes.is_empty());
        }
    }
    let role = roles::find("af-attack").unwrap();
    let baseline = attributes(10);
    let mut key_change = baseline.clone();
    key_change["finishing"] = json!(11);
    let mut preferable_change = baseline.clone();
    preferable_change["passing"] = json!(11);
    near(
        role.rate(&key_change).score.unwrap() - 50.0,
        2.0 * (role.rate(&preferable_change).score.unwrap() - 50.0),
    );
    let mut unrelated = baseline;
    for key in [
        "ca",
        "pa",
        "positionRatings",
        "consistency",
        "leftFoot",
        "corners",
        "injuryProneness",
    ] {
        unrelated[key] = json!(200);
    }
    assert_eq!(role.rate(&unrelated).score, Some(50.0));
    // Acceleration is preferable only for AP Attack, so these duties must diverge.
    let mut player = attributes(10);
    player["acceleration"] = json!(20);
    assert_eq!(
        roles::find("ap-support").unwrap().rate(&player).score,
        Some(50.0)
    );
    assert!(
        roles::find("ap-attack")
            .unwrap()
            .rate(&player)
            .score
            .unwrap()
            > 50.0
    );
}

#[test]
fn incomplete_or_invalid_weighted_attributes_never_produce_a_rating() {
    let role = roles::find("af-attack").unwrap();
    for invalid in [
        Value::Null,
        json!(0),
        json!(21),
        json!(-1),
        json!("15"),
        json!(true),
    ] {
        for key in ["finishing", "passing"] {
            let mut player = attributes(15);
            player[key] = invalid.clone();
            let rated = role.rate(&player);
            assert!(rated.score.is_none());
            assert_eq!(rated.missing_attributes, [key]);
        }
    }
    let mut player = attributes(15);
    player.as_object_mut().unwrap().remove("finishing");
    assert_eq!(role.rate(&player).missing_attributes, ["finishing"]);
    player["finishing"] = json!(15);
    player.as_object_mut().unwrap().remove("corners");
    assert_eq!(role.rate(&player).score, Some(75.0));
}

fn snapshot() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let save_path = dir.path().join("career.fm");
    support::archive(&save_path, true, "24.3.0+0", 40);
    let cancel = CancellationToken::new();
    let mut save = parse_save(&save_path, &cancel, |_, _| {}).unwrap();
    for p in &mut save.players {
        p.ca = 100 + p.id as u8;
        p.attributes = CATALOG
            .attributes
            .iter()
            .enumerate()
            .map(|(i, a)| (a.key.clone(), ((p.id as usize * 7 + i * 3) % 20 + 1) as u8))
            .collect();
    }
    let path = dir.path().join("snapshot.sqlite");
    // This is the original snapshot format: no role columns or stored roleRatings.
    storage::create_snapshot(&path, &save, json!({}), &cancel).unwrap();
    (dir, path)
}

#[test]
fn session_cache_matches_uncached_search_and_reuses_both_directions() {
    let (_dir, path) = snapshot();
    let before = fs::read(&path).unwrap();
    let writer = Connection::open(&path).unwrap();
    writer.execute("UPDATE players SET name=CASE id % 3 WHEN 0 THEN 'ALICE' WHEN 1 THEN 'alice' ELSE 'Bob' END, club=CASE id % 3 WHEN 0 THEN NULL WHEN 1 THEN 'Club' ELSE 'CLUB' END, attr_finishing=CASE WHEN id % 5=0 THEN NULL ELSE attr_finishing END", []).unwrap();
    let nulls = CATALOG
        .attributes
        .iter()
        .map(|a| format!("attr_{}=NULL", a.key))
        .collect::<Vec<_>>()
        .join(",");
    writer
        .execute(&format!("UPDATE players SET {nulls} WHERE id=1"), [])
        .unwrap();
    drop(writer);
    let unchanged = fs::read(&path).unwrap();
    assert_ne!(before, unchanged);
    let db = storage::open_snapshot(&path).unwrap();
    let mut custom = fm_savelens_backend::rating_systems::RatingStore::default()
        .create(&json!({"name":"Cache test"}))
        .unwrap();
    let mut added = custom.roles[0].clone();
    added.id = format!("custom-{}", uuid::Uuid::new_v4());
    added.weights = Some(serde_json::from_value(json!({"finishing":1.25,"pace":3.75})).unwrap());
    let added_id = added.id.clone();
    custom.roles.push(added);
    let mut systems = fm_savelens_backend::rating_systems::builtins().to_vec();
    systems.push(&custom);
    for system in systems {
        let mut session = storage::SearchSession::open(&path, system).unwrap();
        let mut sorts = vec![
            "name",
            "club",
            "age",
            "ca",
            "pa",
            "bestRoleRating",
            "roleRating",
            "role:af-attack",
        ];
        sorts.extend(CATALOG.attributes.iter().map(|a| a.key.as_str()));
        for sort in sorts {
            let builds = session.sort_builds();
            for direction in ["asc", "desc"] {
                for page in [1, 2, 6, 999] {
                    let query = format!("sort={sort}&direction={direction}&page={page}&limit=7&role=af-attack&roles=af-attack,ap-support&bestRole=1");
                    assert_eq!(
                        session.search(&query).unwrap(),
                        storage::search_with_system(&db, &query, system).unwrap(),
                        "{query}"
                    );
                }
            }
            assert_eq!(
                session.sort_builds(),
                builds + usize::from(sort != "role:af-attack"),
                "{sort}"
            );
        }
        let query = "sort=bestRoleRating&direction=desc&bestRole=1&role=ap-support&roleMin=40&caMin=115&nation=12&position=12&q=alice&limit=7";
        let paired = session
            .search(&format!("{query}&includeReversePage=1"))
            .unwrap();
        let expected = storage::search_with_system(&db, query, system).unwrap();
        assert_eq!(paired["players"], expected["players"]);
        assert_eq!(
            paired["reversePage"],
            storage::search_with_system(
                &db,
                &query.replace("direction=desc", "direction=asc"),
                system
            )
            .unwrap()
        );
        let builds = session.sort_builds();
        session
            .search(&query.replace("bestRole=1", "bestRole=0"))
            .unwrap();
        assert_eq!(session.sort_builds(), builds);
        assert!(session.memory_bytes().unwrap() > 0);
        for role in [&system.roles[64].id, &system.roles.last().unwrap().id] {
            let query = format!("roles={role}&sort=role:{role}&bestRole=1&includeReversePage=1");
            assert_eq!(
                session.search(&query).unwrap(),
                storage::search_with_system(&db, &query, system).unwrap()
            );
        }
        if system.id == custom.id {
            assert_eq!(system.roles.last().unwrap().id, added_id);
        }
    }
    assert_eq!(fs::read(&path).unwrap(), unchanged);
}

#[test]
fn session_cache_evicts_old_orders_and_validates_every_request() {
    let (_dir, path) = snapshot();
    let mut session =
        storage::SearchSession::open(&path, &fm_savelens_backend::rating_systems::BUILTIN).unwrap();
    for age in 0..32 {
        session.search(&format!("ageMin={age}")).unwrap();
    }
    assert_eq!(session.sort_builds(), 32);
    session
        .search("ageMin=0&direction=asc&limit=7&page=2&bestRole=1")
        .unwrap();
    session.search("ageMin=32").unwrap();
    session.search("ageMin=0").unwrap();
    assert_eq!(session.sort_builds(), 33);
    session.search("ageMin=1").unwrap();
    assert_eq!(session.sort_builds(), 34);
    for invalid in [
        "direction=sideways",
        "includeReversePage=2",
        "roles=unknown",
        "page=0",
        "roleMin=10",
        "sort=unknown",
    ] {
        assert!(session.search(invalid).is_err(), "{invalid}");
    }
    assert_eq!(session.sort_builds(), 34);
    session.search("ageMin=1").unwrap();
    assert_eq!(session.sort_builds(), 34);
}

#[test]
fn best_role_matches_profiles_and_sorts_before_pagination_in_all_systems() {
    use fm_savelens_backend::rating_systems::{builtins, RatingStore, BUILTIN};
    let (_dir, path) = snapshot();
    let before = fs::read(&path).unwrap();
    let db = storage::open_snapshot(&path).unwrap();
    let mut custom_roles = BUILTIN.roles.clone();
    let mut added = custom_roles
        .iter()
        .find(|role| role.id == "af-attack")
        .unwrap()
        .clone();
    added.id = format!("custom-{}", uuid::Uuid::new_v4());
    added.name = "Finishing specialist".into();
    added.weights = Some(serde_json::from_value(json!({"finishing": 1})).unwrap());
    let added_id = added.id.clone();
    custom_roles.push(added);
    let custom = RatingStore::default()
        .create(&json!({"name":"Best role test","roles":custom_roles}))
        .unwrap();
    let mut systems = builtins().to_vec();
    systems.push(&custom);
    for system in systems {
        let plain = storage::search_with_system(&db, "limit=250", system).unwrap();
        let mut expected = plain["players"].as_array().unwrap().clone();
        for player in &mut expected {
            assert!(player.get("bestRole").is_none());
            let detail =
                storage::player_with_system(&db, player["id"].as_u64().unwrap() as u32, system)
                    .unwrap();
            let mut ratings = detail["roleRatings"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|rating| rating["score"].is_number())
                .collect::<Vec<_>>();
            ratings.sort_by(|a, b| {
                b["score"]
                    .as_f64()
                    .unwrap()
                    .total_cmp(&a["score"].as_f64().unwrap())
                    .then_with(|| a["roleId"].as_str().cmp(&b["roleId"].as_str()))
            });
            player["bestRole"] = json!({"roleId":ratings[0]["roleId"],"score":ratings[0]["score"]});
        }
        if system.id == custom.id {
            assert!(expected
                .iter()
                .any(|player| player["bestRole"]["roleId"] == added_id));
        }
        let display =
            storage::search_with_system(&db, "bestRole=1&roles=af-attack&limit=250", system)
                .unwrap();
        for (actual, expected) in display["players"].as_array().unwrap().iter().zip(&expected) {
            assert_eq!(actual["id"], expected["id"]);
            assert_eq!(actual["bestRole"]["roleId"], expected["bestRole"]["roleId"]);
            near(
                actual["bestRole"]["score"].as_f64().unwrap(),
                expected["bestRole"]["score"].as_f64().unwrap(),
            );
            assert_eq!(actual["roleScores"].as_object().unwrap().len(), 1);
        }
        for direction in ["asc", "desc"] {
            expected.sort_by(|a, b| {
                let order = a["bestRole"]["score"]
                    .as_f64()
                    .unwrap()
                    .total_cmp(&b["bestRole"]["score"].as_f64().unwrap());
                (if direction == "asc" {
                    order
                } else {
                    order.reverse()
                })
                .then_with(|| b["ca"].as_u64().cmp(&a["ca"].as_u64()))
                .then_with(|| a["id"].as_u64().cmp(&b["id"].as_u64()))
            });
            for (page, chunk) in expected.chunks(7).enumerate() {
                let result = storage::search_with_system(
                    &db,
                    &format!(
                        "bestRole=1&sort=bestRoleRating&direction={direction}&limit=7&page={}",
                        page + 1
                    ),
                    system,
                )
                .unwrap();
                assert_eq!(result["total"], expected.len());
                assert_eq!(result["systemId"], system.id);
                assert_eq!(result["systemRevision"], system.revision);
                let rows = result["players"].as_array().unwrap();
                assert_eq!(rows.len(), chunk.len());
                for (actual, expected) in rows.iter().zip(chunk) {
                    assert_eq!(actual["id"], expected["id"]);
                    assert_eq!(actual["bestRole"]["roleId"], expected["bestRole"]["roleId"]);
                    near(
                        actual["bestRole"]["score"].as_f64().unwrap(),
                        expected["bestRole"]["score"].as_f64().unwrap(),
                    );
                    assert!(actual.get("roleScores").is_none());
                }
            }
        }
        let filtered = storage::search_with_system(
            &db,
            "bestRole=1&sort=bestRoleRating&role=ap-support&roleMin=40&caMin=115&limit=250",
            system,
        )
        .unwrap();
        for actual in filtered["players"].as_array().unwrap() {
            let original = expected
                .iter()
                .find(|player| player["id"] == actual["id"])
                .unwrap();
            assert_eq!(actual["bestRole"], original["bestRole"]);
            assert!(actual["roleRating"].as_f64().unwrap() >= 40.0);
            assert!(actual["ca"].as_u64().unwrap() >= 115);
        }
    }
    drop(db);
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn best_role_ignores_missing_scores_resolves_ties_and_retains_nulls_last() {
    let (_dir, path) = snapshot();
    let writer = Connection::open(&path).unwrap();
    let all_null = CATALOG
        .attributes
        .iter()
        .map(|a| format!("attr_{}=NULL", a.key))
        .collect::<Vec<_>>()
        .join(",");
    writer.execute(&format!("UPDATE players SET {all_null},detail=json_set(detail,'$.attributes',json('{{}}')) WHERE id=1"), []).unwrap();
    let all_equal = CATALOG
        .attributes
        .iter()
        .map(|a| format!("attr_{}=15", a.key))
        .collect::<Vec<_>>()
        .join(",");
    writer.execute(&format!("UPDATE players SET {all_equal},position_mask=0,detail=json_set(detail,'$.attributes',json(?)) WHERE id=2"), [attributes(15).to_string()]).unwrap();
    writer.execute("UPDATE players SET attr_finishing=NULL,detail=json_remove(detail,'$.attributes.finishing') WHERE id=3", []).unwrap();
    drop(writer);
    let db = storage::open_snapshot(&path).unwrap();
    for direction in ["asc", "desc"] {
        let result = storage::search(
            &db,
            &format!("bestRole=1&sort=bestRoleRating&direction={direction}&limit=250"),
        )
        .unwrap();
        let rows = result["players"].as_array().unwrap();
        assert_eq!(rows.last().unwrap()["id"], 1);
        assert!(rows.last().unwrap()["bestRole"].is_null());
        assert!(rows[..39]
            .iter()
            .all(|player| player["bestRole"]["score"].is_number()));
        assert_eq!(
            rows.iter().find(|p| p["id"] == 2).unwrap()["bestRole"],
            json!({"roleId":"af-attack","score":75.0})
        );
    }
    for query in [
        "bestRole=1&caMin=200",
        "bestRole=1&page=999",
        "sort=bestRoleRating&caMin=200",
    ] {
        assert_eq!(storage::search(&db, query).unwrap()["players"], json!([]));
    }
    for query in ["bestRole=2", "bestRole=-1", "bestRole=foo", "bestRole=0.5"] {
        assert!(storage::search(&db, query).is_err(), "{query}");
    }
    assert!(storage::search(&db, "bestRole=0").unwrap()["players"][0]
        .get("bestRole")
        .is_none());
}

#[test]
fn custom_weights_match_sql_filtering_sorting_columns_and_pagination() {
    use fm_savelens_backend::rating_systems::{RatingStore, BUILTIN};
    let (_dir, path) = snapshot();
    let writer = Connection::open(&path).unwrap();
    writer.execute("UPDATE players SET attr_consistency=NULL, detail=json_remove(detail,'$.attributes.consistency') WHERE id=1", []).unwrap();
    drop(writer);
    let before = fs::read(&path).unwrap();
    let db = storage::open_snapshot(&path).unwrap();
    let mut roles = BUILTIN.roles.clone();
    let mut custom = roles
        .iter()
        .find(|role| role.id == "af-attack")
        .unwrap()
        .clone();
    custom.id = format!("custom-{}", uuid::Uuid::new_v4());
    custom.name = "Two-footed consistent forward".into();
    custom.weights = Some(
        serde_json::from_value(
            json!({"finishing":1.25,"leftFoot":0.5,"rightFoot":0.75,"consistency":2.5,"passing":0}),
        )
        .unwrap(),
    );
    let id = custom.id.clone();
    roles.push(custom);
    let system = RatingStore::default()
        .create(&json!({"name":"Custom","roles":roles}))
        .unwrap();
    for direction in ["asc", "desc"] {
        let query = format!("role={id}&roles={id},af-attack&sort=role:{id}&direction={direction}");
        let all = storage::search_with_system(&db, &format!("{query}&limit=250"), &system).unwrap();
        assert_eq!(all["systemId"], system.id);
        assert_eq!(all["systemRevision"], 1);
        let rows = all["players"].as_array().unwrap();
        assert_eq!(rows.last().unwrap()["id"], 1);
        assert!(rows.last().unwrap()["roleRating"].is_null());
        let mut expected_scores = vec![];
        for row in rows {
            let detail =
                storage::player_with_system(&db, row["id"].as_u64().unwrap() as u32, &system)
                    .unwrap();
            let rating = detail["roleRatings"]
                .as_array()
                .unwrap()
                .iter()
                .find(|rating| rating["roleId"] == id)
                .unwrap();
            assert_eq!(row["roleRating"], row["roleScores"][&id]);
            if let Some(score) = row["roleRating"].as_f64() {
                near(score, rating["score"].as_f64().unwrap());
                expected_scores.push(score);
            } else {
                assert_eq!(rating["missingAttributes"], json!(["consistency"]));
            }
        }
        for scores in expected_scores.windows(2) {
            assert!(if direction == "asc" {
                scores[0] <= scores[1]
            } else {
                scores[0] >= scores[1]
            });
        }
        for (page, chunk) in rows.chunks(7).enumerate() {
            let result = storage::search_with_system(
                &db,
                &format!("{query}&limit=7&page={}", page + 1),
                &system,
            )
            .unwrap();
            assert_eq!(result["players"].as_array().unwrap(), chunk);
        }
        let threshold = expected_scores[12];
        let filtered = storage::search_with_system(
            &db,
            &format!("{query}&limit=250&roleMin={threshold}"),
            &system,
        )
        .unwrap();
        assert_eq!(
            filtered["total"],
            expected_scores
                .iter()
                .filter(|score| **score >= threshold)
                .count()
        );
    }
    drop(db);
    assert_eq!(before, fs::read(path).unwrap());
}

#[tokio::test]
async fn player_api_uses_active_identity_and_rejects_stale_system_requests() {
    use fm_savelens_backend::{rating_systems::BUILTIN_ID, service};
    let (_snapshot_dir, snapshot_path) = snapshot();
    let data = tempfile::tempdir().unwrap();
    let snapshot_id = "a".repeat(64);
    fs::create_dir(data.path().join("snapshots")).unwrap();
    fs::copy(
        snapshot_path,
        data.path()
            .join("snapshots")
            .join(format!("{snapshot_id}.sqlite")),
    )
    .unwrap();
    let server = service::start(0, data.path()).await.unwrap();
    let url = server.url();
    let client = reqwest::Client::new();
    let created: Value = client
        .post(format!("{url}/api/rating-systems"))
        .json(&json!({"name":"Active custom"}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let hybrid_id = fm_savelens_backend::hybrid::SYSTEM_ID;
    client
        .put(format!("{url}/api/rating-systems/active"))
        .json(&json!({"systemId":hybrid_id}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let hybrid_detail: Value = client
        .get(format!("{url}/api/snapshots/{snapshot_id}/players/1"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(hybrid_detail["systemId"], hybrid_id);
    for rating in hybrid_detail["roleRatings"].as_array().unwrap() {
        near(
            rating["score"].as_f64().unwrap(),
            0.70 * rating["components"]["testingScore"].as_f64().unwrap()
                + 0.30 * rating["components"]["roleScore"].as_f64().unwrap(),
        );
    }
    let stale_url =
        format!("{url}/api/snapshots/{snapshot_id}/players?systemId={BUILTIN_ID}&systemRevision=1");
    assert_eq!(client.get(stale_url).send().await.unwrap().status(), 409);
    client
        .put(format!("{url}/api/rating-systems/active"))
        .json(&json!({"systemId":created["id"]}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    for suffix in ["", "/1"] {
        let path = format!("{url}/api/snapshots/{snapshot_id}/players{suffix}");
        let result: Value = client
            .get(&path)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(result["systemId"], created["id"]);
        assert_eq!(result["systemRevision"], 1);
        for query in [format!("systemId={BUILTIN_ID}"), "systemRevision=0".into()] {
            assert_eq!(
                client
                    .get(format!("{path}?{query}"))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                409
            );
        }
    }
    server.shutdown().await.unwrap();
}

#[test]
fn all_hybrid_roles_match_sql_with_nulls_filters_sorting_and_pagination() {
    use fm_savelens_backend::rating_systems::HYBRID;
    let (_dir, path) = snapshot();
    let writer = Connection::open(&path).unwrap();
    writer.execute("UPDATE players SET attr_consistency=NULL, detail=json_remove(detail,'$.attributes.consistency') WHERE id=1", []).unwrap();
    drop(writer);
    let before = fs::read(&path).unwrap();
    let db = storage::open_snapshot(&path).unwrap();
    let players = storage::search_with_system(&db, "limit=250", &HYBRID).unwrap();
    let details: std::collections::HashMap<u32, Value> = players["players"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            let id = row["id"].as_u64().unwrap() as u32;
            (id, storage::player_with_system(&db, id, &HYBRID).unwrap())
        })
        .collect();
    for role in &HYBRID.roles {
        for direction in ["asc", "desc"] {
            let query = format!(
                "role={}&roles={},af-attack&sort=role:{}&direction={direction}",
                role.id, role.id, role.id
            );
            let results =
                storage::search_with_system(&db, &format!("{query}&limit=250"), &HYBRID).unwrap();
            assert_eq!(results["systemId"], HYBRID.id);
            let rows = results["players"].as_array().unwrap();
            let mut scores = vec![];
            let mut seen_null = false;
            for row in rows {
                let detail = &details[&(row["id"].as_u64().unwrap() as u32)];
                let rating = detail["roleRatings"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|r| r["roleId"] == role.id)
                    .unwrap();
                assert_eq!(row["roleRating"], row["roleScores"][&role.id]);
                if let Some(score) = row["roleRating"].as_f64() {
                    assert!(!seen_null);
                    near(score, rating["score"].as_f64().unwrap());
                    near(
                        score,
                        0.7 * rating["components"]["testingScore"].as_f64().unwrap()
                            + 0.3 * rating["components"]["roleScore"].as_f64().unwrap(),
                    );
                    scores.push(score);
                } else {
                    seen_null = true;
                    assert_eq!(row["id"], 1);
                    assert!(rating["score"].is_null() && rating.get("components").is_none());
                    assert_eq!(rating["missingAttributes"], json!(["consistency"]));
                }
            }
            assert_eq!(seen_null, role.group != "Goalkeepers");
            for pair in scores.windows(2) {
                assert!(if direction == "asc" {
                    pair[0] <= pair[1]
                } else {
                    pair[0] >= pair[1]
                });
            }
            if matches!(role.id.as_str(), "cd-defend" | "gk-defend") {
                let threshold = scores[12];
                let filtered = storage::search_with_system(
                    &db,
                    &format!("{query}&roleMin={threshold}&limit=250"),
                    &HYBRID,
                )
                .unwrap();
                assert_eq!(
                    filtered["total"],
                    scores.iter().filter(|score| **score >= threshold).count()
                );
                for (page, expected) in rows.chunks(7).enumerate() {
                    let paged = storage::search_with_system(
                        &db,
                        &format!("{query}&limit=7&page={}", page + 1),
                        &HYBRID,
                    )
                    .unwrap();
                    assert_eq!(paged["players"].as_array().unwrap(), expected);
                }
            }
        }
    }
    drop(db);
    assert_eq!(before, fs::read(path).unwrap());
}

#[test]
fn every_role_matches_sql_and_existing_snapshots_are_unchanged() {
    let (_dir, path) = snapshot();
    let before = fs::read(&path).unwrap();
    let db = storage::open_snapshot(&path).unwrap();
    let plain = storage::search(&db, "limit=250").unwrap();
    assert!(plain["players"][0].get("roleRating").is_none());
    let mut details = std::collections::HashMap::new();
    for player in plain["players"].as_array().unwrap() {
        let id = player["id"].as_u64().unwrap() as u32;
        details.insert(id, storage::player(&db, id).unwrap());
    }
    for role in &ROLES.roles {
        let result =
            storage::search(&db, &format!("role={}&sort=roleRating&limit=250", role.id)).unwrap();
        let mut last = f64::INFINITY;
        for player in result["players"].as_array().unwrap() {
            let id = player["id"].as_u64().unwrap() as u32;
            let detail = &details[&id];
            assert_eq!(detail["roleRatings"].as_array().unwrap().len(), 85);
            let rated = detail["roleRatings"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["roleId"] == role.id)
                .unwrap();
            let actual = player["roleRating"].as_f64().unwrap();
            near(actual, rated["score"].as_f64().unwrap());
            assert!(actual <= last);
            last = actual;
        }
    }
    drop(db);
    assert_eq!(fs::read(path).unwrap(), before);
}

#[test]
fn role_search_filters_globally_and_paginates_with_stable_ties() {
    let (_dir, path) = snapshot();
    let db = storage::open_snapshot(&path).unwrap();
    let all = storage::search(&db, "role=af-attack&sort=roleRating&limit=250").unwrap();
    let rows = all["players"].as_array().unwrap();
    for (page, expected) in rows.chunks(7).enumerate() {
        let result = storage::search(
            &db,
            &format!("role=af-attack&sort=roleRating&limit=7&page={}", page + 1),
        )
        .unwrap();
        assert_eq!(result["total"], 40);
        assert_eq!(result["players"].as_array().unwrap(), expected);
    }
    let threshold = rows[12]["roleRating"].as_f64().unwrap();
    let expected: Vec<_> = rows
        .iter()
        .filter(|r| {
            r["roleRating"].as_f64().unwrap() >= threshold && r["ca"].as_u64().unwrap() >= 115
        })
        .cloned()
        .collect();
    let result = storage::search(&db, &format!("role=af-attack&roleMin={threshold}&caMin=115&club=-1&nation=12&position=12&q=alvaro&sort=roleRating&limit=250")).unwrap();
    assert_eq!(result["total"], expected.len());
    assert_eq!(result["players"].as_array().unwrap(), &expected);
    assert_eq!(
        storage::search(&db, "role=af-attack&roleMin=100").unwrap()["total"],
        0
    );
    for pair in rows.windows(2) {
        if pair[0]["roleRating"] == pair[1]["roleRating"] {
            assert!(pair[0]["ca"].as_u64().unwrap() >= pair[1]["ca"].as_u64().unwrap());
        }
    }
}

#[test]
fn unavailable_scores_sort_last_in_both_directions_and_are_excluded_by_thresholds() {
    let (_dir, path) = snapshot();
    let writer = Connection::open(&path).unwrap();
    for (id, value) in [
        (1, Value::Null),
        (2, json!(0)),
        (3, json!(21)),
        (4, json!("unknown")),
    ] {
        let mut detail = storage::player(&writer, id).unwrap();
        detail["attributes"]["passing"] = value.clone();
        writer
            .execute(
                "UPDATE players SET attr_passing=json_extract(?,'$'),detail=? WHERE id=?",
                rusqlite::params![value.to_string(), detail.to_string(), id],
            )
            .unwrap();
    }
    // Positional familiarity and ability do not alter the mathematical score.
    let before = storage::player(&writer, 5).unwrap()["roleRatings"].clone();
    writer.execute("UPDATE players SET position_mask=0,ca=1,pa=1,detail=json_set(detail,'$.positionRatings',json('[1,1,1]'),'$.ca',1,'$.pa',1) WHERE id=5", []).unwrap();
    assert_eq!(storage::player(&writer, 5).unwrap()["roleRatings"], before);
    drop(writer);
    let db = storage::open_snapshot(&path).unwrap();
    for direction in ["asc", "desc"] {
        let result = storage::search(
            &db,
            &format!("role=af-attack&sort=roleRating&direction={direction}&limit=250"),
        )
        .unwrap();
        let rows = result["players"].as_array().unwrap();
        assert!(rows[..36].iter().all(|p| p["roleRating"].is_number()));
        assert!(rows[36..].iter().all(|p| p["roleRating"].is_null()));
        for p in &rows[36..] {
            let detail = storage::player(&db, p["id"].as_u64().unwrap() as u32).unwrap();
            let af = detail["roleRatings"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["roleId"] == "af-attack")
                .unwrap();
            assert!(af["score"].is_null());
            assert_eq!(af["missingAttributes"], json!(["passing"]));
        }
    }
    assert_eq!(
        storage::search(&db, "role=af-attack&roleMin=0").unwrap()["total"],
        36
    );
}

#[test]
fn invalid_role_queries_are_rejected() {
    let (_dir, path) = snapshot();
    let db = storage::open_snapshot(&path).unwrap();
    for query in [
        "role=unknown",
        "role=af-attack%27",
        "roleMin=75",
        "sort=roleRating",
        "role=&roleMin=0",
        "role=af-attack&roleMin=NaN",
        "role=af-attack&roleMin=inf",
        "role=af-attack&roleMin=-1",
        "role=af-attack&roleMin=100.1",
        "role=af-attack&roleMin=%20",
        "role=af-attack&roleMin=foo",
        "role=af-attack&direction=sideways",
        "roles=af-attack,invalid",
        "roles=af-attack,",
        "roles=af-attack%27",
        "sort=role:invalid",
        "sort=role:",
    ] {
        assert_eq!(
            storage::search(&db, query).unwrap_err().code,
            "INVALID_QUERY",
            "{query}"
        );
    }
    assert!(storage::search(&db, "role=af-attack&roleMin=70.5").is_ok());
}

#[test]
fn all_role_columns_match_details_without_affecting_filters_or_pagination() {
    let (_dir, path) = snapshot();
    let before = fs::read(&path).unwrap();
    let db = storage::open_snapshot(&path).unwrap();
    let ids = ROLES
        .roles
        .iter()
        .map(|r| r.id.as_str())
        .collect::<Vec<_>>()
        .join(",");
    let query = "role=af-attack&roleMin=40&caMin=115&club=-1&nation=12&position=12&q=alvaro&sort=role:tf-support&limit=7&page=2";
    let plain = storage::search(&db, query).unwrap();
    let mut columns = storage::search(&db, &format!("{query}&roles={ids},af-attack")).unwrap();
    assert!(!columns["players"].as_array().unwrap().is_empty());
    for player in columns["players"].as_array_mut().unwrap() {
        let detail = storage::player(&db, player["id"].as_u64().unwrap() as u32).unwrap();
        assert_eq!(player["roleScores"].as_object().unwrap().len(), 85);
        for rating in detail["roleRatings"].as_array().unwrap() {
            near(
                player["roleScores"][rating["roleId"].as_str().unwrap()]
                    .as_f64()
                    .unwrap(),
                rating["score"].as_f64().unwrap(),
            );
        }
        near(
            player["roleScores"]["af-attack"].as_f64().unwrap(),
            player["roleRating"].as_f64().unwrap(),
        );
        player.as_object_mut().unwrap().remove("roleScores");
    }
    assert_eq!(plain, columns);
    let beyond_last = storage::search(
        &db,
        &format!("{}&roles={ids}", query.replace("page=2", "page=999")),
    )
    .unwrap();
    assert_eq!(beyond_last["total"], plain["total"]);
    assert_eq!(beyond_last["players"], json!([]));
    drop(db);
    assert_eq!(fs::read(path).unwrap(), before);
}

#[test]
fn display_role_sort_is_global_independent_and_keeps_missing_scores_last() {
    let (_dir, path) = snapshot();
    let writer = Connection::open(&path).unwrap();
    writer
        .execute("UPDATE players SET attr_finishing=NULL WHERE id=1", [])
        .unwrap();
    drop(writer);
    let db = storage::open_snapshot(&path).unwrap();
    for direction in ["asc", "desc"] {
        let legacy = storage::search(
            &db,
            &format!("role=af-attack&sort=roleRating&direction={direction}&limit=250"),
        )
        .unwrap();
        let expected = legacy["players"].as_array().unwrap();
        assert!(expected.last().unwrap()["roleRating"].is_null());
        for (page, chunk) in expected.chunks(7).enumerate() {
            let result = storage::search(&db, &format!("roles=af-attack,ap-support,tf-support&sort=role:af-attack&direction={direction}&limit=7&page={}", page + 1)).unwrap();
            assert_eq!(result["total"], 40);
            let actual = result["players"].as_array().unwrap();
            assert_eq!(actual.len(), chunk.len());
            for (row, expected) in actual.iter().zip(chunk) {
                assert_eq!(row["id"], expected["id"]);
                assert_eq!(row["roleScores"]["af-attack"], expected["roleRating"]);
                assert!(row.get("roleRating").is_none());
                assert!(row["roleScores"]["ap-support"].is_number());
            }
        }
    }
    let empty = storage::search(&db, "roles=af-attack,tf-support&caMin=200").unwrap();
    assert_eq!(empty["total"], 0);
    assert_eq!(empty["players"], json!([]));
}
