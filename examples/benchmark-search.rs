//! Run with an existing snapshot path; the snapshot is opened read-only.
use fm_savelens_backend::{rating_systems, storage, Result};
use serde_json::json;
use std::{path::PathBuf, time::Instant};

fn main() -> Result<()> {
    let path = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("Pass a snapshot SQLite path"),
    )
    .canonicalize()?;
    let db = storage::open_snapshot(&path)?;
    for system in rating_systems::builtins() {
        let query = "sort=bestRoleRating&direction=desc&page=1&limit=50&bestRole=1";
        let start = Instant::now();
        let original = storage::search_with_system(&db, query, system)?;
        let uncached_ms = start.elapsed().as_secs_f64() * 1000.0;
        let start = Instant::now();
        let mut session = storage::SearchSession::open(&path, system)?;
        let prepare_ms = start.elapsed().as_secs_f64() * 1000.0;
        let start = Instant::now();
        let paired = session.search(&format!("{query}&includeReversePage=1"))?;
        let first_sort_ms = start.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(original["players"], paired["players"]);
        let mut warm_ms = vec![];
        for i in 0..20 {
            let direction = if i % 2 == 0 { "asc" } else { "desc" };
            let start = Instant::now();
            session.search(&query.replace("direction=desc", &format!("direction={direction}")))?;
            warm_ms.push(start.elapsed().as_secs_f64() * 1000.0);
        }
        warm_ms.sort_by(f64::total_cmp);
        assert_eq!(session.sort_builds(), 1);
        println!(
            "{}",
            json!({
                "system":system.id, "players":original["total"], "uncachedBestSortMs":uncached_ms,
                "prepareRatingsMs":prepare_ms, "firstPairedBestSortMs":first_sort_ms,
                "warmMedianMs":warm_ms[warm_ms.len()/2], "warmMaxMs":warm_ms.last(),
                "sortBuilds":session.sort_builds(), "cacheAllocatedBytes":session.memory_bytes()?
            })
        );
    }
    Ok(())
}
