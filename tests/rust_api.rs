mod support;
use fm_savelens_backend::service;
use serde_json::{json, Value};
use std::{fs, time::Duration};
async fn value(response: reqwest::Response) -> Value {
    assert!(response.status().is_success(), "{}", response.status());
    response.json().await.unwrap()
}

async fn select_save(client: &reqwest::Client, url: &str, games: &std::path::Path) -> Value {
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
    saves["saves"][0].clone()
}

async fn finish_job(client: &reqwest::Client, url: &str, mut job: Value) -> Value {
    tokio::time::timeout(Duration::from_secs(10), async {
        while job["status"] == "running" {
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
        job
    })
    .await
    .expect("Import did not complete")
}

async fn delayed_import(
    address: std::net::SocketAddr,
    save_id: &Value,
) -> (tokio::net::TcpStream, String) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let body = json!({"saveId":save_id}).to_string();
    let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
    let headers = format!("POST /api/imports HTTP/1.1\r\nHost: {address}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n", body.len());
    stream.write_all(headers.as_bytes()).await.unwrap();
    // The handshake proves the handler is waiting for the body. No timing sleep.
    let expected = b"HTTP/1.1 100 Continue\r\n\r\n";
    let mut response = vec![0; expected.len()];
    tokio::time::timeout(Duration::from_secs(10), stream.read_exact(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response, expected);
    (stream, body)
}

#[tokio::test]
async fn shutdown_rejects_delayed_imports_including_cached_saves() {
    use std::future::{poll_fn, Future};
    use std::task::Poll;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    for cached in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let games = dir.path().join("games");
        fs::create_dir(&games).unwrap();
        support::archive(&games.join("career.fm"), true, "24.3.0+0", 64);
        let data = dir.path().join("data");
        let server = service::start(0, &data).await.unwrap();
        let url = server.url();
        let client = reqwest::Client::new();
        let save = select_save(&client, &url, &games).await;
        if cached {
            let job = value(
                client
                    .post(format!("{url}/api/imports"))
                    .json(&json!({"saveId":save["id"]}))
                    .send()
                    .await
                    .unwrap(),
            )
            .await;
            finish_job(&client, &url, job).await;
        }
        let previous_settings = fs::read(data.join("settings.json")).unwrap();
        let (mut stream, body) = delayed_import(server.address, &save["id"]).await;
        let mut shutdown = Box::pin(server.shutdown());
        // Poll through the synchronous shutdown gate before releasing the body.
        // The outstanding request means shutdown must still be pending.
        poll_fn(|cx| {
            assert!(shutdown.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
        stream.write_all(body.as_bytes()).await.unwrap();
        let mut response = String::new();
        tokio::time::timeout(
            Duration::from_secs(10),
            stream.read_to_string(&mut response),
        )
        .await
        .unwrap()
        .unwrap();
        tokio::time::timeout(Duration::from_secs(10), shutdown)
            .await
            .unwrap()
            .unwrap();
        assert!(
            response.starts_with("HTTP/1.1 503 Service Unavailable\r\n"),
            "{response}"
        );
        let error: Value =
            serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(error, json!({"error":"The app is shutting down."}));
        assert_eq!(
            fs::read(data.join("settings.json")).unwrap(),
            previous_settings
        );
        let snapshots: Vec<_> = fs::read_dir(data.join("snapshots"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(
            snapshots.len(),
            usize::from(cached),
            "Unexpected publication or partial snapshot"
        );
        if cached {
            assert_eq!(
                snapshots[0],
                format!("{}.sqlite", save["snapshotId"].as_str().unwrap()).as_str()
            );
        }
        // A surviving worker would retain the data-directory lock.
        let reopened = service::start(0, &data).await.unwrap();
        let job = value(
            client
                .post(format!("{}/api/imports", reopened.url()))
                .json(&json!({"saveId":save["id"]}))
                .send()
                .await
                .unwrap(),
        )
        .await;
        finish_job(&client, &reopened.url(), job).await;
        reopened.shutdown().await.unwrap();
    }
}

#[tokio::test]
async fn shutdown_waits_for_active_import_cleanup_and_releases_data_directory() {
    let dir = tempfile::tempdir().unwrap();
    let games = dir.path().join("games");
    fs::create_dir(&games).unwrap();
    support::archive(&games.join("career.fm"), false, "24.3.0+0", 50_000);
    let data = dir.path().join("data");
    let server = service::start(0, &data).await.unwrap();
    let client = reqwest::Client::new();
    let save = select_save(&client, &server.url(), &games).await;
    let job = value(
        client
            .post(format!("{}/api/imports", server.url()))
            .json(&json!({"saveId":save["id"]}))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(job["status"], "running");
    tokio::time::timeout(Duration::from_secs(10), server.shutdown())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(fs::read_dir(data.join("snapshots")).unwrap().count(), 0);
    let reopened = service::start(0, &data).await.unwrap();
    let settings = value(
        client
            .get(format!("{}/api/settings", reopened.url()))
            .send()
            .await
            .unwrap(),
    )
    .await;
    assert_eq!(settings["activeJob"], Value::Null);
    assert_eq!(settings["lastSnapshot"], Value::Null);
    reopened.shutdown().await.unwrap();
}

#[tokio::test]
async fn loopback_origins_allow_settings_and_imports_and_reject_foreign_requests() {
    let dir = tempfile::tempdir().unwrap();
    let games = dir.path().join("games");
    fs::create_dir(&games).unwrap();
    support::archive(&games.join("career.fm"), true, "24.3.0+0", 64);
    let server = service::start(0, &dir.path().join("data")).await.unwrap();
    let port = server.address.port();
    let client = reqwest::Client::new();
    for host in ["127.0.0.1", "localhost"] {
        let origin = format!("http://{host}:{port}");
        assert_eq!(client.get(&origin).send().await.unwrap().status(), 200);
        value(
            client
                .put(format!("{origin}/api/settings"))
                .header("Origin", &origin)
                .json(&json!({"folder":games}))
                .send()
                .await
                .unwrap(),
        )
        .await;
        let saves = value(
            client
                .get(format!("{origin}/api/saves"))
                .header("Origin", &origin)
                .send()
                .await
                .unwrap(),
        )
        .await;
        let job = value(
            client
                .post(format!("{origin}/api/imports"))
                .header("Origin", &origin)
                .json(&json!({"saveId":saves["saves"][0]["id"]}))
                .send()
                .await
                .unwrap(),
        )
        .await;
        finish_job(&client, &origin, job).await;
    }
    let other_port = if port == 65535 { port - 1 } else { port + 1 };
    for origin in [
        "https://example.com".to_string(),
        "null".to_string(),
        format!("http://localhost:{other_port}"),
        format!("http://127.0.0.1:{other_port}"),
        format!("https://localhost:{port}"),
        format!("http://localhost:{port}.example.com"),
    ] {
        assert_eq!(
            client
                .put(format!("{}/api/settings", server.url()))
                .header("Origin", origin)
                .json(&json!({"folder":games}))
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    for host in ["example.com".to_string(), format!("localhost:{other_port}")] {
        assert_eq!(
            client
                .get(format!("{}/api/health", server.url()))
                .header("Host", host)
                .send()
                .await
                .unwrap()
                .status(),
            403
        );
    }
    assert_eq!(
        client
            .get(format!("{}/api/health", server.url()))
            .header("Origin", "http://127.0.0.1:5173")
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    server.shutdown().await.unwrap();
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
