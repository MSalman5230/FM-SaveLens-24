use crate::{Error, Result, VERSION};
use chrono::Utc;
use reqwest::blocking::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

const RELEASES_API: &str =
    "https://api.github.com/repos/MSalman5230/FM-SaveLens-24/releases/latest";
const RELEASES_PAGE: &str = "https://github.com/MSalman5230/FM-SaveLens-24/releases/tag/";
const DAY: i64 = 24 * 60 * 60;
const COOLDOWN: i64 = 60;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Saved {
    automatic: bool,
    dismissed_version: Option<String>,
    last_checked_at: Option<i64>,
    last_attempt_at: Option<i64>,
    retry_at: Option<i64>,
    release_tag: Option<String>,
    error: Option<String>,
}
impl Default for Saved {
    fn default() -> Self {
        Self {
            automatic: true,
            dismissed_version: None,
            last_checked_at: None,
            last_attempt_at: None,
            retry_at: None,
            release_tag: None,
            error: None,
        }
    }
}

pub(super) struct UpdateStore {
    path: PathBuf,
    // Only update operations share this lock; save processing never waits on HTTP.
    saved: Mutex<Saved>,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    state: String,
    size: u64,
}

fn stable_version(tag: &str) -> Option<Version> {
    let version = Version::parse(tag.strip_prefix('v').unwrap_or(tag)).ok()?;
    (version.pre.is_empty() && version.build.is_empty()).then_some(version)
}

fn validate_release(release: Release) -> std::result::Result<String, CheckFailure> {
    let version = stable_version(&release.tag_name)
        .filter(|_| !release.draft && !release.prerelease)
        .ok_or_else(|| {
            CheckFailure::message(
                "The latest release is not a valid stable version. Try again later.",
            )
        })?;
    let prefix = format!("FM-SaveLens-24-v{version}");
    let mut expected = [
        "windows-x64-portable.zip",
        "windows-x64-setup.exe",
        "linux-x86_64.AppImage",
        "linux-x86_64.flatpak",
        "macos-arm64.dmg",
        "macos-x86_64.dmg",
    ]
    .map(|suffix| format!("{prefix}-{suffix}"))
    .to_vec();
    expected.push("SHA256SUMS.txt".into());
    if expected.iter().any(|name| {
        !release
            .assets
            .iter()
            .any(|asset| &asset.name == name && asset.state == "uploaded" && asset.size > 0)
    }) {
        return Err(CheckFailure::message(
            "The latest release's downloads are still being prepared. Try again later.",
        ));
    }
    Ok(release.tag_name)
}

struct CheckFailure {
    message: String,
    retry_at: Option<i64>,
}
impl CheckFailure {
    fn message(message: &str) -> Self {
        Self {
            message: message.into(),
            retry_at: None,
        }
    }
}

fn rate_limit_retry(headers: &reqwest::header::HeaderMap, now: i64) -> i64 {
    let after = headers
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .parse::<i64>()
                .ok()
                .map(|seconds| now.saturating_add(seconds.max(0)))
                .or_else(|| {
                    chrono::DateTime::parse_from_rfc2822(value)
                        .ok()
                        .map(|time| time.timestamp())
                })
        });
    let reset = headers
        .get("x-ratelimit-reset")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok());
    after
        .into_iter()
        .chain(reset)
        .max()
        .unwrap_or(now.saturating_add(COOLDOWN))
        .clamp(now.saturating_add(COOLDOWN), now.saturating_add(DAY))
}

fn fetch_release(endpoint: &str) -> std::result::Result<String, CheckFailure> {
    fetch_with_timeout(endpoint, Duration::from_secs(10))
}

fn fetch_with_timeout(
    endpoint: &str,
    timeout: Duration,
) -> std::result::Result<String, CheckFailure> {
    let unavailable = || {
        CheckFailure::message("Could not check for updates. Check your connection and try again.")
    };
    let client = Client::builder()
        .timeout(timeout)
        .user_agent("FM-SaveLens-24-update-check")
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| unavailable())?;
    let response = client
        .get(endpoint)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .map_err(|_| unavailable())?;
    if matches!(response.status().as_u16(), 403 | 429) {
        return Err(CheckFailure {
            message: "GitHub has temporarily limited update checks. Please try again later.".into(),
            retry_at: Some(rate_limit_retry(response.headers(), Utc::now().timestamp())),
        });
    }
    if !response.status().is_success() {
        return Err(unavailable());
    }
    let release = response.json::<Release>().map_err(|_| unavailable())?;
    validate_release(release)
}

impl UpdateStore {
    pub(super) fn load(data: &Path) -> Self {
        let path = data.join("updates.json");
        let saved = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_else(|| Saved {
                // An unreadable preference must not silently override an earlier opt-out.
                automatic: !path.exists(),
                ..Saved::default()
            });
        Self {
            path,
            saved: Mutex::new(saved),
        }
    }

    fn persist(&self, next: &Saved) -> Result<()> {
        let mut file =
            tempfile::NamedTempFile::new_in(self.path.parent().expect("data directory"))?;
        file.write_all(&serde_json::to_vec_pretty(next)?)?;
        file.as_file().sync_all()?;
        file.persist(&self.path)
            .map_err(|error| Error::from(error.error))?;
        Ok(())
    }

    fn view(saved: &Saved) -> Value {
        let latest = saved.release_tag.as_deref().and_then(stable_version);
        let available = latest
            .as_ref()
            .is_some_and(|latest| *latest > Version::parse(VERSION).expect("app version"));
        json!({
            "version": VERSION, "automatic": saved.automatic,
            "dismissedVersion": saved.dismissed_version,
            "lastCheckedAt": saved.last_checked_at,
            "nextAutomaticCheckAt": saved.last_attempt_at.map(|time| time.saturating_add(DAY))
                .unwrap_or(0).max(saved.retry_at.unwrap_or(0)),
            "retryAt": saved.retry_at,
            "latestVersion": latest.map(|version| version.to_string()),
            "updateAvailable": available,
            "releaseUrl": if available { saved.release_tag.as_ref().map(|tag| format!("{RELEASES_PAGE}{tag}")) } else { None },
            "error": saved.error,
        })
    }

    pub(super) fn status(&self) -> Value {
        Self::view(&self.saved.lock().unwrap())
    }

    pub(super) fn check(&self, manual: bool) -> Result<Value> {
        self.check_with(manual, Utc::now().timestamp(), || {
            fetch_release(RELEASES_API)
        })
    }

    fn check_with(
        &self,
        manual: bool,
        now: i64,
        fetch: impl FnOnce() -> std::result::Result<String, CheckFailure>,
    ) -> Result<Value> {
        // Serialization plus the persisted cooldown coalesces simultaneous requests.
        let mut saved = self.saved.lock().unwrap();
        if (!manual && !saved.automatic)
            || saved.retry_at.is_some_and(|time| time > now)
            || (!manual
                && saved
                    .last_attempt_at
                    .is_some_and(|time| time.saturating_add(DAY) > now))
        {
            return Ok(Self::view(&saved));
        }
        let mut next = saved.clone();
        next.last_attempt_at = Some(now);
        next.retry_at = Some(now.saturating_add(COOLDOWN));
        match fetch() {
            Ok(tag) => {
                next.release_tag = Some(tag);
                next.last_checked_at = Some(now);
                next.error = None;
            }
            Err(error) => {
                next.error = Some(error.message);
                next.retry_at = Some(
                    error
                        .retry_at
                        .unwrap_or(0)
                        .max(now.saturating_add(COOLDOWN)),
                );
            }
        }
        self.persist(&next)?;
        *saved = next;
        Ok(Self::view(&saved))
    }

    pub(super) fn preferences(&self, body: &Value) -> Result<Value> {
        let mut saved = self.saved.lock().unwrap();
        let mut next = saved.clone();
        if let Some(automatic) = body.get("automatic") {
            next.automatic = automatic
                .as_bool()
                .ok_or_else(|| Error::query("Expected automatic to be a boolean."))?;
        }
        if let Some(dismissed) = body.get("dismissedVersion") {
            let version = dismissed
                .as_str()
                .ok_or_else(|| Error::query("Expected a version to dismiss."))?;
            if Self::view(&saved)["latestVersion"].as_str() != Some(version)
                || Self::view(&saved)["updateAvailable"] != true
            {
                return Err(Error::query("Only the available update can be dismissed."));
            }
            next.dismissed_version = Some(version.into());
        }
        self.persist(&next)?;
        *saved = next;
        Ok(Self::view(&saved))
    }

    pub(super) fn release_url(&self) -> Result<String> {
        Self::view(&self.saved.lock().unwrap())["releaseUrl"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| Error::query("There is no available release to open."))
    }
}

#[cfg(test)]
mod tests;
