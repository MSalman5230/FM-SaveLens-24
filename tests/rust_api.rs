mod support;
use fm_savelens_backend::service;
use serde_json::{json, Value};
use std::{fs, time::Duration};
async fn value(response: reqwest::Response) -> Value {
    assert!(response.status().is_success(), "{}", response.status());
    response.json().await.unwrap()
}
#[tokio::test]
async fn concurrent_import_cancellation_and_failure_leave_no_partial_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let games = dir.path().join("games");
    fs::create_dir(&games).unwrap();
    // Large enough for a second request to overlap parsing, without private data.
    support::archive(&games.join("career.fm"), false, "24.3.0+0", 50_000);
    let data = dir.path().join("data");
    let server = service::start(0, &data).await.unwrap();
    let url = server.url();
    let client = reqwest::Client::new();
    value(
        client
            .put(format!("{url}/api/settings"))
            .json(&json!({"folder":games}))
            .send()
            .await
            .unwrap(),
    )
    .await;
    let saves = value(client.get(format!("{url}/api/saves")).send().await.unwrap()).await;
    let save_id = saves["saves"][0]["id"].clone();
    let request = || {
        client
            .post(format!("{url}/api/imports"))
            .json(&json!({"saveId":save_id}))
            .send()
    };
    let (a, b) = tokio::join!(request(), request());
    let (a, b) = (a.unwrap(), b.unwrap());
    let (accepted, rejected) = if a.status().is_success() {
        (a, b)
    } else {
        (b, a)
    };
    assert_eq!(rejected.status(), 400);
    let job = value(accepted).await;
    let cancelled = value(
        client
            .delete(format!("{url}/api/imports/{}", job["id"].as_str().unwrap()))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(cancelled["status"], "cancelled", "{cancelled}");
    assert_eq!(fs::read_dir(data.join("snapshots")).unwrap().count(), 0);
    // Failed imports clean up and release the single-writer slot as well.
    fs::write(games.join("career.fm"), b"truncated").unwrap();
    let mut failed = value(request().await.unwrap()).await;
    for _ in 0..400 {
        if failed["status"] != "running" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
        failed = value(
            client
                .get(format!(
                    "{url}/api/imports/{}",
                    failed["id"].as_str().unwrap()
                ))
                .send()
                .await
                .unwrap(),
        )
        .await;
    }
    assert_eq!(failed["status"], "error", "{failed}");
    assert_eq!(fs::read_dir(data.join("snapshots")).unwrap().count(), 0);
    server.shutdown().await.unwrap();
}
#[tokio::test]
async fn api_import_cache_security_and_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let games = dir.path().join("games");
    fs::create_dir(&games).unwrap();
    let data = dir.path().join("data");
    support::archive(&games.join("career.fm"), true, "24.3.0+0", 64);
    let server = service::start(0, &data).await.unwrap();
    assert!(service::start(0, &data).await.is_err());
    let url = server.url();
    let client = reqwest::Client::new();
    assert_eq!(
        client
            .get(format!("{url}/api/health"))
            .header("Origin", "https://example.com")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .get(format!("{url}/api/health"))
            .header("Host", "example.com")
            .send()
            .await
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        value(
            client
                .get(format!("{url}/api/health"))
                .send()
                .await
                .unwrap()
        )
        .await["version"],
        fm_savelens_backend::VERSION
    );
    assert_eq!(
        client
            .put(format!("{url}/api/settings"))
            .json(&json!({"folder":"/nonexistent/path"}))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    value(
        client
            .put(format!("{url}/api/settings"))
            .json(&json!({"folder":games}))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(
        client
            .post(format!("{url}/api/imports"))
            .json(&Value::Null)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    let saves = value(client.get(format!("{url}/api/saves")).send().await.unwrap()).await;
    let save_id = saves["saves"][0]["id"].clone();
    let mut job = value(
        client
            .post(format!("{url}/api/imports"))
            .json(&json!({"saveId":save_id}))
            .send()
            .await
            .unwrap(),
    )
    .await;
    for _ in 0..400 {
        if job["status"] != "running" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
        job = value(
            client
                .get(format!("{url}/api/imports/{}", job["id"].as_str().unwrap()))
                .send()
                .await
                .unwrap(),
        )
        .await;
    }
    assert_eq!(job["status"], "complete", "{job}");
    let id = job["snapshotId"].as_str().unwrap();
    let meta = value(
        client
            .get(format!("{url}/api/snapshots/{id}"))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(meta["playerCount"], 64);
    assert_eq!(meta["stale"], false);
    assert_eq!(
        value(
            client
                .get(format!(
                    "{url}/api/snapshots/{id}/players?q=alvaro&limit=25"
                ))
                .send()
                .await
                .unwrap()
        )
        .await["total"],
        64
    );
    let cached = value(
        client
            .post(format!("{url}/api/imports"))
            .json(&json!({"saveId":save_id}))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(cached["status"], "complete");
    let file = fs::OpenOptions::new()
        .write(true)
        .open(games.join("career.fm"))
        .unwrap();
    file.set_len(file.metadata().unwrap().len() + 1).unwrap();
    drop(file);
    assert_eq!(
        value(
            client
                .get(format!("{url}/api/snapshots/{id}"))
                .send()
                .await
                .unwrap()
        )
        .await["stale"],
        true
    );
    server.shutdown().await.unwrap();
    let second = service::start(0, &data).await.unwrap();
    let settings = value(
        client
            .get(format!("{}/api/settings", second.url()))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(settings["lastSnapshot"], id);
    second.shutdown().await.unwrap();
}
