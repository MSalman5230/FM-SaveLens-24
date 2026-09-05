use fm_savelens_backend::{
    rating_systems::{allowed_attribute, validate_roles, RatingStore, BUILTIN, BUILTIN_ID},
    roles::ROLES,
    service,
};
use serde_json::{json, Value};
use std::fs;

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
    assert_eq!(store.active_system_id, BUILTIN_ID);
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
        serde_json::to_value(&BUILTIN.roles).unwrap()
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
        BUILTIN_ID
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
    assert_eq!(list["activeSystemId"], BUILTIN_ID);
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
        BUILTIN_ID
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
    assert_eq!(removed["activeSystemId"], BUILTIN_ID);
    server.shutdown().await.unwrap();
}
