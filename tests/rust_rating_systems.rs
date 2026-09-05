use fm_savelens_backend::{
    rating_systems::{
        allowed_attribute, validate_roles, RatingStore, BUILTIN, BUILTIN_ID, DEFAULT_ID, HYBRID,
    },
    roles::ROLES,
    service,
};
use serde_json::{json, Value};
use std::fs;

fn extra_roles(count: usize) -> Vec<fm_savelens_backend::roles::Role> {
    let mut roles = BUILTIN.roles.clone();
    while roles.len() < count {
        let mut added = roles[0].clone();
        added.id = format!("custom-{}", uuid::Uuid::new_v4());
        added.name = format!("Extra {}", roles.len());
        roles.push(added);
    }
    roles
}

#[test]
fn role_and_library_limits_apply_to_creation_updates_and_loading() {
    use fm_savelens_backend::rating_systems::{MAX_CUSTOM_SYSTEMS, MAX_ROLES_PER_SYSTEM};
    let dir = tempfile::tempdir().unwrap();
    let mut store = RatingStore::default();
    let roles = extra_roles(MAX_ROLES_PER_SYSTEM);
    let first = store
        .create(&json!({"name":"At role capacity","roles":roles}))
        .unwrap();
    let oversized = extra_roles(MAX_ROLES_PER_SYSTEM + 1);
    assert!(store
        .create(&json!({"name":"Too many roles","roles":oversized}))
        .is_err());
    assert!(store
        .update(
            &first.id,
            &json!({"name":first.name,"revision":1,"roles":oversized})
        )
        .is_err());
    assert_eq!(store.find(&first.id).unwrap().revision, 1);
    for i in 1..MAX_CUSTOM_SYSTEMS {
        store
            .create(&json!({"name":format!("System {i}")}))
            .unwrap();
    }
    assert!(store.create(&json!({"name":"One too many"})).is_err());
    store
        .update(&first.id, &json!({"name":"Still editable","revision":1}))
        .unwrap();
    store.persist(dir.path()).unwrap();
    assert_eq!(
        RatingStore::load(dir.path()).unwrap().systems.len(),
        MAX_CUSTOM_SYSTEMS
    );
    store.systems[0].roles = oversized;
    store.persist(dir.path()).unwrap();
    assert!(RatingStore::load(dir.path()).is_err());
    store.systems[0].roles = roles;
    let mut extra = first;
    extra.id = uuid::Uuid::new_v4().to_string();
    extra.name = "Extra saved system".into();
    store.systems.push(extra);
    store.persist(dir.path()).unwrap();
    assert!(RatingStore::load(dir.path()).is_err());
}

#[test]
fn role_identifiers_source_metadata_and_preset_names_are_validated() {
    for id in ["unknown-role", "custom-not-a-uuid"] {
        let mut roles = BUILTIN.roles.clone();
        let mut extra = roles[0].clone();
        extra.id = id.into();
        extra.name = "Extra".into();
        roles.push(extra);
        assert!(validate_roles(&mut roles).is_err());
    }
    for field in ["role", "duty", "group"] {
        for custom in [false, true] {
            let mut roles = BUILTIN.roles.clone();
            let mut invalid = roles[0].clone();
            if custom {
                invalid.id = format!("custom-{}", uuid::Uuid::new_v4());
                invalid.name = "Extra".into();
            }
            match field {
                "role" => invalid.role = "unknown".into(),
                "duty" => invalid.duty = "unknown".into(),
                _ => invalid.group = "unknown".into(),
            }
            if custom {
                roles.push(invalid);
            } else {
                roles[0] = invalid;
            }
            assert!(validate_roles(&mut roles).is_err());
        }
    }
    let mut store = RatingStore::default();
    let custom = store.create(&json!({"name":"Custom"})).unwrap();
    for preset in [&*BUILTIN, &*HYBRID] {
        for name in [
            preset.name.to_uppercase(),
            format!("  {}  ", preset.name.to_lowercase()),
        ] {
            assert!(store.create(&json!({"name":name})).is_err());
            assert!(store
                .update(&custom.id, &json!({"name":name,"revision":1}))
                .is_err());
        }
    }
}

#[tokio::test]
async fn corrupt_and_incompatible_libraries_start_read_only_until_backed_up_and_reset() {
    use fm_savelens_backend::rating_systems::{MAX_CUSTOM_SYSTEMS, MAX_ROLES_PER_SYSTEM};
    let mut valid = RatingStore::default();
    valid.create(&json!({"name":"Saved"})).unwrap();
    let value = serde_json::to_value(&valid).unwrap();
    let mut version = value.clone();
    version["schemaVersion"] = json!(2);
    let mut invalid = value.clone();
    invalid["systems"][0]["roles"] = json!([]);
    let mut unknown = value.clone();
    unknown["activeSystemId"] = json!("missing");
    let mut too_many_roles = value.clone();
    too_many_roles["systems"][0]["roles"] = json!(extra_roles(MAX_ROLES_PER_SYSTEM + 1));
    let mut too_many_systems = value.clone();
    too_many_systems["systems"] = json!(vec![&value["systems"][0]; MAX_CUSTOM_SYSTEMS + 1]);
    let mut cases = vec![b"{not json".to_vec()];
    cases.extend(
        [version, invalid, unknown, too_many_roles, too_many_systems]
            .iter()
            .map(|v| serde_json::to_vec(v).unwrap()),
    );
    let client = reqwest::Client::new();
    for original in cases {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rating-systems.json");
        fs::write(&path, &original).unwrap();
        let server = service::start(0, dir.path()).await.unwrap();
        let url = server.url();
        let library = request(
            &client,
            &url,
            reqwest::Method::GET,
            "/rating-systems",
            None,
            200,
        )
        .await;
        assert!(library["recovery"]["message"].is_string());
        assert_eq!(library["activeSystemId"], DEFAULT_ID);
        assert_eq!(library["systems"].as_array().unwrap().len(), 2);
        assert_eq!(
            library["limits"],
            json!({"maxCustomSystems":32,"maxRolesPerSystem":128})
        );
        request(&client, &url, reqwest::Method::GET, "/roles", None, 200).await;
        request(
            &client,
            &url,
            reqwest::Method::PUT,
            "/settings",
            Some(json!({"folder":dir.path()})),
            200,
        )
        .await;
        for (method, endpoint, body) in [
            (
                reqwest::Method::POST,
                "/rating-systems".to_owned(),
                json!({"name":"Blocked"}),
            ),
            (
                reqwest::Method::PUT,
                "/rating-systems/active".to_owned(),
                json!({"systemId":BUILTIN_ID}),
            ),
            (
                reqwest::Method::PUT,
                format!("/rating-systems/{}", valid.systems[0].id),
                json!({"name":"Blocked","revision":1}),
            ),
            (
                reqwest::Method::DELETE,
                format!("/rating-systems/{}", valid.systems[0].id),
                Value::Null,
            ),
        ] {
            let error = request(
                &client,
                &url,
                method,
                &endpoint,
                (!body.is_null()).then_some(body),
                409,
            )
            .await;
            assert_eq!(error["code"], "RECOVERY_REQUIRED");
        }
        assert_eq!(fs::read(&path).unwrap(), original);
        let reset = request(
            &client,
            &url,
            reqwest::Method::POST,
            "/rating-systems/reset",
            Some(json!({})),
            200,
        )
        .await;
        assert!(reset.get("recovery").is_none());
        let backup = reset["backupFilename"].as_str().unwrap();
        assert!(backup.starts_with("rating-systems.backup-"));
        assert_eq!(fs::read(dir.path().join(backup)).unwrap(), original);
        request(
            &client,
            &url,
            reqwest::Method::POST,
            "/rating-systems/reset",
            Some(json!({})),
            409,
        )
        .await;
        let created = request(
            &client,
            &url,
            reqwest::Method::POST,
            "/rating-systems",
            Some(json!({"name":"Recovered"})),
            201,
        )
        .await;
        server.shutdown().await.unwrap();
        let server = service::start(0, dir.path()).await.unwrap();
        let restarted = request(
            &client,
            &server.url(),
            reqwest::Method::GET,
            "/rating-systems",
            None,
            200,
        )
        .await;
        assert!(restarted.get("recovery").is_none());
        assert!(restarted["systems"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["id"] == created["id"]));
        assert_eq!(fs::read(dir.path().join(backup)).unwrap(), original);
        server.shutdown().await.unwrap();
    }
}

#[tokio::test]
async fn unreadable_recovery_source_cannot_be_reset_or_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("rating-systems.json");
    fs::create_dir(&path).unwrap();
    let server = service::start(0, dir.path()).await.unwrap();
    let client = reqwest::Client::new();
    request(
        &client,
        &server.url(),
        reqwest::Method::POST,
        "/rating-systems/reset",
        Some(json!({})),
        500,
    )
    .await;
    assert!(path.is_dir());
    let library = request(
        &client,
        &server.url(),
        reqwest::Method::GET,
        "/rating-systems",
        None,
        200,
    )
    .await;
    assert!(library["recovery"].is_object());
    server.shutdown().await.unwrap();
}

#[test]
fn builtin_scores_are_identical_and_custom_weights_have_the_expected_mean() {
    for value in [1.0, 10.25, 15.0, 20.0] {
        let attributes: Value = fm_savelens_backend::parser::CATALOG
            .attributes
            .iter()
            .map(|attribute| (attribute.key.clone(), json!(value)))
            .collect();
        for original in &ROLES.roles {
            assert_eq!(
                original.rate(&attributes).score,
                BUILTIN.find(&original.id).unwrap().rate(&attributes).score
            );
        }
    }
    let mut roles = BUILTIN.roles.clone();
    let weights =
        json!({"finishing":1.5,"leftFoot":0.5,"rightFoot":2.0,"consistency":1.0,"passing":0.0});
    roles[0].weights = Some(serde_json::from_value(weights).unwrap());
    validate_roles(&mut roles).unwrap();
    let values = json!({"finishing":18,"leftFoot":8,"rightFoot":20,"consistency":12});
    assert_eq!(roles[0].rate(&values).score, Some(83.0));
    for key in ["finishing", "leftFoot", "rightFoot", "consistency"] {
        for invalid in [Value::Null, json!(0), json!(21), json!("10")] {
            let mut missing = values.clone();
            missing[key] = invalid;
            let result = roles[0].rate(&missing);
            assert!(result.score.is_none());
            assert_eq!(result.missing_attributes, [key]);
        }
    }
    assert!(
        allowed_attribute("leftFoot")
            && allowed_attribute("rightFoot")
            && allowed_attribute("consistency")
    );
    assert!(!allowed_attribute("injuryProneness") && !allowed_attribute("professionalism"));
}

#[test]
fn custom_validation_rejects_unsafe_attributes_invalid_weights_and_duplicate_roles() {
    for weights in [
        json!({}),
        json!({"passing":0}),
        json!({"passing":-1}),
        json!({"injuryProneness":0}),
        json!({"passing);DROP TABLE players;--":2}),
    ] {
        let mut roles = BUILTIN.roles.clone();
        roles[0].weights = Some(serde_json::from_value(weights).unwrap());
        assert!(validate_roles(&mut roles).is_err());
    }
    for value in [f64::INFINITY, f64::NAN, f64::MAX] {
        let mut roles = BUILTIN.roles.clone();
        roles[0].weights = Some([("passing".into(), value)].into());
        assert!(validate_roles(&mut roles).is_err());
    }
    let mut roles = BUILTIN.roles.clone();
    roles.remove(0);
    assert!(validate_roles(&mut roles).is_err());
    let mut roles = BUILTIN.roles.clone();
    roles.push(roles[0].clone());
    assert!(validate_roles(&mut roles).is_err());
    let mut roles = BUILTIN.roles.clone();
    let mut duplicate = roles[0].clone();
    duplicate.id = format!("custom-{}", uuid::Uuid::new_v4());
    roles.push(duplicate);
    assert!(validate_roles(&mut roles).is_err());
    roles.last_mut().unwrap().name = "My goalkeeper".into();
    validate_roles(&mut roles).unwrap();
}

#[test]
fn copies_are_independent_and_persist_the_active_system_without_touching_settings() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("settings.json"), b"legacy settings").unwrap();
    let mut store = RatingStore::load(dir.path()).unwrap();
    assert_eq!(store.active_system_id, DEFAULT_ID);
    let first = store.create(&json!({"name":"My system"})).unwrap();
    let second = store
        .create(&json!({"name":"Second system", "sourceId":first.id}))
        .unwrap();
    let mut edited = first.roles.clone();
    edited[0].weights = Some([("consistency".into(), 1.25)].into());
    let mut new_role = edited[0].clone();
    new_role.id = format!("custom-{}", uuid::Uuid::new_v4());
    new_role.name = "Consistent keeper".into();
    edited.push(new_role);
    let updated = store
        .update(
            &first.id,
            &json!({"name":first.name,"revision":first.revision,"roles":edited}),
        )
        .unwrap();
    assert_eq!(updated.revision, 2);
    assert_eq!(updated.roles.len(), 86);
    assert_eq!(store.find(&second.id).unwrap().roles.len(), 85);
    assert_eq!(
        serde_json::to_value(&store.find(&second.id).unwrap().roles).unwrap(),
        serde_json::to_value(&HYBRID.roles).unwrap()
    );
    assert!(store.create(&json!({"name":" MY SYSTEM "})).is_err());
    assert!(store
        .update(&first.id, &json!({"name":"My system","revision":1}))
        .is_err());
    assert!(store
        .update(BUILTIN_ID, &json!({"name":"Overwrite","revision":1}))
        .is_err());
    assert!(store.delete(BUILTIN_ID).is_err());
    store.activate(&first.id).unwrap();
    store.persist(dir.path()).unwrap();
    let mut loaded = RatingStore::load(dir.path()).unwrap();
    assert_eq!(loaded.active().id, first.id);
    assert_eq!(loaded.active().roles.len(), 86);
    let retained = loaded
        .active()
        .roles
        .iter()
        .filter(|role| !role.id.starts_with("custom-"))
        .cloned()
        .collect::<Vec<_>>();
    let without_added_role = loaded
        .update(
            &first.id,
            &json!({"name":first.name,"revision":2,"roles":retained}),
        )
        .unwrap();
    assert_eq!(without_added_role.roles.len(), 85);
    assert_eq!(
        without_added_role.roles[0].weights.as_ref().unwrap()["consistency"],
        1.25
    );
    assert_eq!(
        fs::read(dir.path().join("settings.json")).unwrap(),
        b"legacy settings"
    );
    loaded.delete(&first.id).unwrap();
    loaded.persist(dir.path()).unwrap();
    assert_eq!(
        RatingStore::load(dir.path()).unwrap().active_system_id,
        DEFAULT_ID
    );
}

async fn request(
    client: &reqwest::Client,
    base: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<Value>,
    status: u16,
) -> Value {
    let mut request = client.request(method, format!("{base}/api{path}"));
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.unwrap();
    let actual = response.status().as_u16();
    let value: Value = response.json().await.unwrap();
    assert_eq!(actual, status, "{path}: {value}");
    value
}

#[tokio::test]
async fn hybrid_api_lists_protects_activates_and_copies_the_new_preset() {
    use fm_savelens_backend::{hybrid, rating_systems::HYBRID};
    const GET: reqwest::Method = reqwest::Method::GET;
    const POST: reqwest::Method = reqwest::Method::POST;
    const PUT: reqwest::Method = reqwest::Method::PUT;
    const DELETE: reqwest::Method = reqwest::Method::DELETE;
    let dir = tempfile::tempdir().unwrap();
    let server = service::start(0, dir.path()).await.unwrap();
    let client = reqwest::Client::new();
    let url = server.url();
    let endpoint = format!("/rating-systems/{}", hybrid::SYSTEM_ID);
    let definition = request(&client, &url, GET, &endpoint, None, 200).await;
    assert_eq!(definition["roles"].as_array().unwrap().len(), 85);
    assert_eq!(definition["builtIn"], true);
    request(
        &client,
        &url,
        PUT,
        &endpoint,
        Some(json!({"name":"Changed","revision":1})),
        400,
    )
    .await;
    request(&client, &url, DELETE, &endpoint, None, 400).await;
    let active = request(
        &client,
        &url,
        PUT,
        "/rating-systems/active",
        Some(json!({"systemId":hybrid::SYSTEM_ID})),
        200,
    )
    .await;
    assert_eq!(active["catalog"]["modelVersion"], hybrid::MODEL_VERSION);
    assert!(active["catalog"].get("keyWeight").is_none());
    assert_eq!(
        request(&client, &url, GET, "/roles", None, 200).await,
        HYBRID.catalog()
    );
    let copy = request(
        &client,
        &url,
        POST,
        "/rating-systems",
        Some(json!({"name":"Hybrid copy","sourceId":hybrid::SYSTEM_ID})),
        201,
    )
    .await;
    assert_eq!(copy["roles"], definition["roles"]);
    assert_eq!(copy["builtIn"], false);
    assert_eq!(
        request(&client, &url, GET, "/rating-systems", None, 200).await["activeSystemId"],
        hybrid::SYSTEM_ID
    );
    server.shutdown().await.unwrap();
    let server = service::start(0, dir.path()).await.unwrap();
    assert_eq!(
        request(&client, &server.url(), GET, "/roles", None, 200).await["systemId"],
        hybrid::SYSTEM_ID
    );
    server.shutdown().await.unwrap();
}

#[tokio::test]
async fn api_handles_complete_catalogs_conflicts_restart_and_atomic_write_failures() {
    const GET: reqwest::Method = reqwest::Method::GET;
    const POST: reqwest::Method = reqwest::Method::POST;
    const PUT: reqwest::Method = reqwest::Method::PUT;
    const DELETE: reqwest::Method = reqwest::Method::DELETE;
    let dir = tempfile::tempdir().unwrap();
    let server = service::start(0, dir.path()).await.unwrap();
    let client = reqwest::Client::new();
    let url = server.url();
    let list = request(&client, &url, GET, "/rating-systems", None, 200).await;
    assert_eq!(list["activeSystemId"], DEFAULT_ID);
    assert_eq!(list["catalog"]["roles"].as_array().unwrap().len(), 85);
    // An unwritable destination must not publish the proposed state in memory.
    let path = dir.path().join("rating-systems.json");
    fs::create_dir(&path).unwrap();
    request(
        &client,
        &url,
        POST,
        "/rating-systems",
        Some(json!({"name":"Failed creation"})),
        500,
    )
    .await;
    assert_eq!(
        request(&client, &url, GET, "/rating-systems", None, 200).await["systems"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    fs::remove_dir(&path).unwrap();
    let mut roles = BUILTIN.roles.clone();
    for role in &mut roles {
        role.weights = Some(
            fm_savelens_backend::parser::CATALOG
                .attributes
                .iter()
                .filter(|attribute| allowed_attribute(&attribute.key))
                .map(|attribute| (attribute.key.clone(), 1.125))
                .collect(),
        );
    }
    let body = json!({"name":"Complete custom catalog","roles":roles});
    assert!(body.to_string().len() > 65536);
    let created = request(&client, &url, POST, "/rating-systems", Some(body), 201).await;
    let id = created["id"].as_str().unwrap();
    let endpoint = format!("/rating-systems/{id}");
    assert_eq!(
        request(&client, &url, GET, "/roles", None, 200).await["systemId"],
        DEFAULT_ID
    );
    let updated = request(
        &client,
        &url,
        PUT,
        &endpoint,
        Some(json!({"name":"Renamed","revision":1,"roles":created["roles"]})),
        200,
    )
    .await;
    assert_eq!(updated["revision"], 2);
    request(
        &client,
        &url,
        PUT,
        &endpoint,
        Some(json!({"name":"Stale","revision":1})),
        409,
    )
    .await;
    request(
        &client,
        &url,
        PUT,
        "/rating-systems/active",
        Some(json!({"systemId":id})),
        200,
    )
    .await;
    assert_eq!(
        request(&client, &url, GET, "/roles", None, 200).await["systemName"],
        "Renamed"
    );
    request(
        &client,
        &url,
        PUT,
        "/settings",
        Some(json!({"folder":dir.path()})),
        200,
    )
    .await;
    assert_eq!(
        request(&client, &url, GET, "/roles", None, 200).await["systemId"],
        id
    );
    let before = fs::read(&path).unwrap();
    request(
        &client,
        &url,
        PUT,
        &endpoint,
        Some(json!({"name":"Invalid","revision":2,"roles":[]})),
        400,
    )
    .await;
    assert_eq!(fs::read(&path).unwrap(), before);
    let backup = dir.path().join("ratings-backup.json");
    fs::rename(&path, &backup).unwrap();
    fs::create_dir(&path).unwrap();
    request(
        &client,
        &url,
        PUT,
        &endpoint,
        Some(json!({"name":"Failed update","revision":2})),
        500,
    )
    .await;
    assert_eq!(
        request(&client, &url, GET, &endpoint, None, 200).await["name"],
        "Renamed"
    );
    fs::remove_dir(&path).unwrap();
    fs::rename(&backup, &path).unwrap();
    server.shutdown().await.unwrap();
    let server = service::start(0, dir.path()).await.unwrap();
    let url = server.url();
    assert_eq!(
        request(&client, &url, GET, "/roles", None, 200).await["systemId"],
        id
    );
    request(
        &client,
        &url,
        DELETE,
        &format!("/rating-systems/{BUILTIN_ID}"),
        None,
        400,
    )
    .await;
    let removed = request(&client, &url, DELETE, &endpoint, None, 200).await;
    assert_eq!(removed["activeSystemId"], DEFAULT_ID);
    server.shutdown().await.unwrap();
}
