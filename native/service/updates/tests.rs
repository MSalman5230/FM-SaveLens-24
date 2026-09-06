use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier,
    },
    thread,
};

fn release(tag: &str) -> Release {
    let version = tag.trim_start_matches('v');
    let mut assets = [
        "windows-x64-portable.zip",
        "windows-x64-setup.exe",
        "linux-x86_64.AppImage",
        "linux-x86_64.flatpak",
        "macos-arm64.dmg",
        "macos-x86_64.dmg",
    ]
    .map(|suffix| Asset {
        name: format!("FM-SaveLens-24-v{version}-{suffix}"),
        state: "uploaded".into(),
        size: 1,
    })
    .into_iter()
    .collect::<Vec<_>>();
    assets.push(Asset {
        name: "SHA256SUMS.txt".into(),
        state: "uploaded".into(),
        size: 1,
    });
    Release {
        tag_name: tag.into(),
        draft: false,
        prerelease: false,
        assets,
    }
}

#[test]
fn accepts_only_complete_stable_releases() {
    assert_eq!(
        validate_release(release("v1.10.0")).unwrap_or_else(|_| panic!()),
        "v1.10.0"
    );
    for tag in [
        "bad",
        "v1.2",
        "v1.2.3-rc.1",
        "v1.2.3+build",
        "v1.2.3/../../evil",
    ] {
        assert!(validate_release(release(tag)).is_err());
    }
    for index in 0..7 {
        let mut candidate = release("v1.2.3");
        candidate.assets.remove(index);
        assert!(validate_release(candidate).is_err());
    }
    let mut candidate = release("v1.2.3");
    candidate.draft = true;
    assert!(validate_release(candidate).is_err());
    let mut candidate = release("v1.2.3");
    candidate.prerelease = true;
    assert!(validate_release(candidate).is_err());
    let mut candidate = release("v1.2.3");
    candidate.assets[0].state = "starter".into();
    assert!(validate_release(candidate).is_err());
    let mut candidate = release("v1.2.3");
    candidate.assets[0].size = 0;
    assert!(validate_release(candidate).is_err());
}

#[test]
fn compares_versions_numerically_and_never_opens_untrusted_urls() {
    assert!(stable_version("v1.10.0") > stable_version("v1.9.0"));
    let current = Version::parse(VERSION).unwrap();
    for (tag, available) in [
        (format!("v{}", current), false),
        ("v0.0.0".into(), false),
        (format!("v{}.0.0", current.major + 1), true),
        ("https://evil.example".into(), false),
    ] {
        let saved = Saved {
            release_tag: Some(tag.clone()),
            ..Saved::default()
        };
        let view = UpdateStore::view(&saved);
        assert_eq!(view["updateAvailable"], available);
        if available {
            assert_eq!(view["releaseUrl"], format!("{RELEASES_PAGE}{tag}"));
        } else {
            assert!(view["releaseUrl"].is_null());
        }
    }
}

#[test]
fn checks_daily_manual_bypasses_daily_cache_and_cooldown_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let store = UpdateStore::load(dir.path());
    let now = 1_000_000;
    store
        .check_with(false, now, || Ok("v9.0.0".into()))
        .unwrap();
    store
        .check_with(false, now + 100, || panic!("daily cache"))
        .unwrap();
    store
        .check_with(true, now + 20, || panic!("manual cooldown"))
        .unwrap();
    store
        .check_with(true, now + 100, || Ok("v9.1.0".into()))
        .unwrap();
    let reopened = UpdateStore::load(dir.path());
    reopened
        .check_with(true, now + 120, || panic!("persisted cooldown"))
        .unwrap();
    let status = reopened
        .check_with(false, now + 100 + DAY, || Ok("v9.2.0".into()))
        .unwrap();
    assert_eq!(status["latestVersion"], "9.2.0");
    assert_eq!(status["lastCheckedAt"], now + 100 + DAY);
}

#[test]
fn failures_preserve_known_release_and_honor_rate_limit() {
    let dir = tempfile::tempdir().unwrap();
    let store = UpdateStore::load(dir.path());
    store
        .check_with(true, 1000, || Ok("v9.0.0".into()))
        .unwrap();
    let status = store
        .check_with(true, 1100, || {
            Err(CheckFailure {
                message: "Limited".into(),
                retry_at: Some(5000),
            })
        })
        .unwrap();
    assert_eq!(status["latestVersion"], "9.0.0");
    assert_eq!(status["lastCheckedAt"], 1000);
    assert_eq!(status["error"], "Limited");
    store
        .check_with(true, 4999, || panic!("rate limited"))
        .unwrap();
    let recovered = store
        .check_with(true, 5000, || Ok("v9.1.0".into()))
        .unwrap();
    assert!(recovered["error"].is_null());
    assert_eq!(recovered["lastCheckedAt"], 5000);
}

#[test]
fn concurrent_checks_make_one_request() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(UpdateStore::load(dir.path()));
    let calls = Arc::new(AtomicUsize::new(0));
    let barrier = Arc::new(Barrier::new(4));
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let (store, calls, barrier) = (store.clone(), calls.clone(), barrier.clone());
            thread::spawn(move || {
                barrier.wait();
                store
                    .check_with(true, 1000, || {
                        calls.fetch_add(1, Ordering::SeqCst);
                        Ok("v9.0.0".into())
                    })
                    .unwrap()
            })
        })
        .collect();
    for handle in handles {
        assert_eq!(handle.join().unwrap()["latestVersion"], "9.0.0");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn preferences_and_dismissal_survive_restart_and_cache_clear() {
    use crate::service::AppState;
    let dir = tempfile::tempdir().unwrap();
    let app = AppState::open(dir.path()).unwrap();
    app.updates
        .check_with(true, 1000, || Ok("v9.0.0".into()))
        .unwrap();
    app.api(
        "PUT",
        "/api/updates",
        "",
        json!({"automatic":false,"dismissedVersion":"9.0.0"}),
    )
    .unwrap();
    app.api("DELETE", "/api/cache", "", Value::Null).unwrap();
    drop(app);
    let reopened = AppState::open(dir.path()).unwrap();
    let status = reopened
        .api("GET", "/api/updates", "", Value::Null)
        .unwrap()
        .1;
    assert_eq!(status["automatic"], false);
    assert_eq!(status["dismissedVersion"], "9.0.0");
    assert!(reopened.updates.release_url().unwrap().ends_with("/v9.0.0"));
    reopened
        .updates
        .check_with(false, DAY + 1000, || panic!("opted out"))
        .unwrap();
    let next = reopened
        .updates
        .check_with(true, DAY + 1000, || Ok("v9.1.0".into()))
        .unwrap();
    assert_ne!(next["dismissedVersion"], next["latestVersion"]);
    assert!(reopened
        .updates
        .preferences(&json!({"dismissedVersion":"8.0.0"}))
        .is_err());
}

#[test]
fn corrupt_update_file_does_not_prevent_startup_or_enable_network() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("updates.json"), "invalid").unwrap();
    let store = UpdateStore::load(dir.path());
    assert_eq!(store.status()["automatic"], false);
    assert!(store.release_url().is_err());
    assert!(store.preferences(&json!({"automatic":"yes"})).is_err());
    store.preferences(&json!({"automatic":true})).unwrap();
    assert_eq!(UpdateStore::load(dir.path()).status()["automatic"], true);
}

#[test]
fn rate_limit_headers_and_offline_responses() {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("retry-after", "120".parse().unwrap());
    headers.insert("x-ratelimit-reset", "1500".parse().unwrap());
    assert_eq!(rate_limit_retry(&headers, 1000), 1500);
    headers.insert(
        "retry-after",
        "Wed, 21 Oct 2015 07:28:00 GMT".parse().unwrap(),
    );
    assert!(rate_limit_retry(&headers, 1000) > 1500);
    assert_eq!(
        rate_limit_retry(&reqwest::header::HeaderMap::new(), 1000),
        1060
    );
    for (code, body) in [
        (429, "{}"),
        (500, "{}"),
        (200, "invalid json"),
        (200, "{}"),
        (302, "{}"),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = [0; 4096];
            let count = stream.read(&mut bytes).unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]).to_lowercase();
            assert!(request.contains("user-agent: fm-savelens-24-update-check"));
            assert!(!request.contains("authorization:"));
            write!(stream, "HTTP/1.1 {code} Test\r\nContent-Length: {}\r\nRetry-After: 120\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        let error = fetch_release(&endpoint).err().unwrap();
        assert_eq!(error.retry_at.is_some(), code == 429);
        server.join().unwrap();
    }
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    assert!(fetch_release(&endpoint).is_err());
}

#[test]
fn stalled_response_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (_stream, _) = listener.accept().unwrap();
        thread::sleep(Duration::from_millis(250));
    });
    let started = std::time::Instant::now();
    assert!(fetch_with_timeout(&endpoint, Duration::from_millis(50)).is_err());
    assert!(started.elapsed() < Duration::from_secs(2));
    server.join().unwrap();
}

#[tokio::test]
async fn update_routes_keep_local_request_protections() {
    let dir = tempfile::tempdir().unwrap();
    let server = crate::service::start(0, dir.path()).await.unwrap();
    let client = reqwest::Client::new();
    let endpoint = format!("{}/api/updates", server.url());
    let response = client
        .get(&endpoint)
        .header("Origin", "https://evil.example")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
    let response = client
        .get(&endpoint)
        .header("Host", "evil.example")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 403);
    let response = client
        .put(&endpoint)
        .header("Content-Type", "text/plain")
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    let response = client
        .put(&endpoint)
        .json(&json!({"automatic":false}))
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
    let response = client
        .post(format!("{endpoint}/check"))
        .json(&json!({"manual":false}))
        .send()
        .await
        .unwrap();
    let status: Value = response.json().await.unwrap();
    assert_eq!(status["automatic"], false);
    assert!(status["lastCheckedAt"].is_null());
    let response = client
        .post(format!("{endpoint}/open"))
        .json(&json!({"url":"https://evil.example"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 400);
    server.shutdown().await.unwrap();
}
