use crate::{
    parser::{archive::check, ParsedSave, CATALOG, PARSER_VERSION},
    Error, Result,
};
use chrono::Utc;
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection, OpenFlags};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    path::Path,
    sync::LazyLock,
};
use tokio_util::sync::CancellationToken;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

static COUNTRIES: LazyLock<HashMap<String, String>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../server/parser/nations.json")).expect("country catalog")
});
pub fn nation_name(id: u32) -> String {
    COUNTRIES
        .get(&id.to_string())
        .cloned()
        .unwrap_or_else(|| format!("Nation {id}"))
}
pub fn normalize(s: &str) -> String {
    s.nfd()
        .filter(|c| !is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase()
}

pub fn create_snapshot(
    path: &Path,
    save: &ParsedSave,
    mut meta: Value,
    cancel: &CancellationToken,
) -> Result<()> {
    let mut db = Connection::open(path)?;
    let attributes = CATALOG
        .attributes
        .iter()
        .map(|a| format!("attr_{} INTEGER", a.key))
        .collect::<Vec<_>>()
        .join(",");
    db.execute_batch(&format!("CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE players (
        id INTEGER PRIMARY KEY,uid INTEGER NOT NULL,name TEXT NOT NULL,full_name TEXT NOT NULL,search_name TEXT NOT NULL,
        age INTEGER,club_id INTEGER,club TEXT,nation_id INTEGER,nations TEXT NOT NULL,positions TEXT NOT NULL,position_mask INTEGER NOT NULL,
        ca INTEGER,pa INTEGER,{attributes},detail TEXT NOT NULL);"))?;
    let tx = db.transaction()?;
    {
        let placeholders = vec!["?"; 15 + CATALOG.attributes.len()].join(",");
        let mut insert = tx.prepare(&format!("INSERT INTO players VALUES ({placeholders})"))?;
        for p in &save.players {
            check(cancel)?;
            let mut nations = vec![p.nation_id as u32];
            nations.extend(&p.other_nation_ids);
            let mut detail = serde_json::to_value(p)?;
            detail["nationalities"] = json!(nations
                .iter()
                .map(|&id| nation_name(id))
                .collect::<Vec<_>>());
            let mut values: Vec<SqlValue> = vec![
                (p.id as i64).into(),
                (p.uid as i64).into(),
                p.name.clone().into(),
                p.full_name.clone().into(),
                normalize(&format!("{} {} {}", p.name, p.full_name, p.uid)).into(),
                (p.age as i64).into(),
                p.club_id.map_or(SqlValue::Null, |id| (id as i64).into()),
                p.club.clone().map_or(SqlValue::Null, SqlValue::Text),
                (p.nation_id as i64).into(),
                serde_json::to_string(&nations)?.into(),
                serde_json::to_string(&p.positions)?.into(),
                p.position_ratings
                    .iter()
                    .enumerate()
                    .fold(
                        0i64,
                        |mask, (i, v)| if *v >= 15 { mask | (1 << i) } else { mask },
                    )
                    .into(),
                (p.ca as i64).into(),
                (p.pa as i64).into(),
            ];
            values.extend(CATALOG.attributes.iter().map(|a| {
                p.attributes
                    .get(&a.key)
                    .map_or(SqlValue::Null, |v| (*v as i64).into())
            }));
            values.push(serde_json::to_string(&detail)?.into());
            insert.execute(params_from_iter(values))?;
        }
    }
    let ids: BTreeSet<u32> = save
        .players
        .iter()
        .flat_map(|p| std::iter::once(p.nation_id as u32).chain(p.other_nation_ids.iter().copied()))
        .collect();
    let mut nations: Vec<_> = ids
        .into_iter()
        .map(|id| json!({"id":id,"name":nation_name(id)}))
        .collect();
    nations.sort_by_key(|v| normalize(v["name"].as_str().unwrap_or("")));
    let used: BTreeSet<_> = save.players.iter().filter_map(|p| p.club_id).collect();
    let mut clubs: Vec<_> = save
        .clubs
        .iter()
        .filter(|c| used.contains(&c.id))
        .map(|c| json!({"id":c.id,"name":c.short_name}))
        .collect();
    clubs.sort_by_key(|v| normalize(v["name"].as_str().unwrap_or("")));
    let fields = json!({"name":save.name,"gameDate":save.game_date,"formatVersion":save.format_version,"playerCount":save.players.len(),"diagnostics":save.diagnostics,"warnings":save.warnings,"importedAt":Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"nations":nations,"clubs":clubs});
    meta.as_object_mut()
        .ok_or_else(|| Error::query("Invalid snapshot metadata."))?
        .extend(fields.as_object().unwrap().clone());
    tx.execute(
        "INSERT INTO metadata VALUES ('snapshot',?)",
        [serde_json::to_string(&meta)?],
    )?;
    check(cancel)?;
    tx.commit()?;
    // Index creation is interruptible too, not only the insertion loop.
    let interrupt = db.get_interrupt_handle();
    let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    std::thread::scope(|scope| -> Result<()> {
        let stopped = done.clone();
        scope.spawn(move || {
            while !stopped.load(std::sync::atomic::Ordering::Relaxed) {
                if cancel.is_cancelled() {
                    interrupt.interrupt();
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        });
        let result = db.execute_batch("CREATE INDEX idx_players_pa ON players(pa DESC,ca DESC,id); CREATE INDEX idx_players_ca ON players(ca); CREATE INDEX idx_players_age ON players(age); CREATE INDEX idx_players_club ON players(club_id); CREATE INDEX idx_players_nation ON players(nation_id); PRAGMA optimize;");
        done.store(true, std::sync::atomic::Ordering::Relaxed);
        check(cancel)?;
        result?;
        Ok(())
    })?;
    Ok(())
}
pub fn open_snapshot(path: &Path) -> Result<Connection> {
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?)
}
pub fn metadata(db: &Connection) -> Result<Value> {
    let raw: String = db.query_row("SELECT value FROM metadata WHERE key='snapshot'", [], |r| {
        r.get(0)
    })?;
    let mut m: Value = serde_json::from_str(&raw)?;
    m["stale"] = json!(
        std::fs::metadata(m["sourcePath"].as_str().unwrap_or("")).map_or(true, |s| {
            s.len() != m["sourceSize"].as_u64().unwrap_or(0)
                || crate::service::mtime(&s).ok() != m["sourceMtime"].as_f64()
                || m["parserVersion"].as_str() != Some(PARSER_VERSION)
        })
    );
    Ok(m)
}
pub fn player(db: &Connection, id: u32) -> Result<Value> {
    use rusqlite::OptionalExtension;
    let raw: Option<String> = db
        .query_row("SELECT detail FROM players WHERE id=?", [id], |r| r.get(0))
        .optional()?;
    raw.map(|r| serde_json::from_str(&r).map_err(Error::from))
        .unwrap_or_else(|| Err(Error::new("NOT_FOUND", "Player not found.")))
}
pub fn search(db: &Connection, query: &str) -> Result<Value> {
    let mut params = HashMap::new();
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        params.entry(k.into_owned()).or_insert(v.into_owned());
    }
    let integer = |key: &str, min: i64, max: i64| -> Result<Option<i64>> {
        let Some(s) = params.get(key).filter(|s| !s.is_empty()) else {
            return Ok(None);
        };
        let n = if s.trim().is_empty() {
            0.0
        } else {
            s.trim()
                .parse::<f64>()
                .map_err(|_| Error::query(format!("Invalid {key}.")))?
        };
        if !n.is_finite() || n.fract() != 0.0 || n < min as f64 || n > max as f64 {
            return Err(Error::query(format!("Invalid {key}.")));
        }
        Ok(Some(n as i64))
    };
    let mut clauses = vec![];
    let mut args: Vec<SqlValue> = vec![];
    if let Some(q) = params.get("q").map(|s| s.trim()).filter(|s| !s.is_empty()) {
        if q.encode_utf16().count() > 200 {
            return Err(Error::query("Search text is too long."));
        }
        clauses.push("search_name LIKE ? ESCAPE '\\'".into());
        args.push(
            format!(
                "%{}%",
                normalize(q)
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            )
            .into(),
        );
    }
    for (field, max) in [("age", 120), ("ca", 200), ("pa", 200)] {
        let min = integer(&format!("{field}Min"), 0, max)?;
        let high = integer(&format!("{field}Max"), 0, max)?;
        if min.zip(high).is_some_and(|(a, b)| a > b) {
            return Err(Error::query(format!("{field} minimum exceeds maximum.")));
        }
        if let Some(n) = min {
            clauses.push(format!("{field} >= ?"));
            args.push(n.into());
        }
        if let Some(n) = high {
            clauses.push(format!("{field} <= ?"));
            args.push(n.into());
        }
    }
    if let Some(n) = integer("club", -1, 100000)? {
        if n == -1 {
            clauses.push("club_id IS NULL".into())
        } else {
            clauses.push("club_id = ?".into());
            args.push(n.into());
        }
    }
    if let Some(n) = integer("nation", 0, 255)? {
        clauses.push("EXISTS (SELECT 1 FROM json_each(players.nations) WHERE value = ?)".into());
        args.push(n.into());
    }
    if let Some(n) = integer("position", 0, 14)? {
        clauses.push("(position_mask & ?) != 0".into());
        args.push((1i64 << n).into());
    }
    for a in &CATALOG.attributes {
        if let Some(n) = integer(&format!("attr_{}", a.key), 1, 20)? {
            clauses.push(format!("attr_{} >= ?", a.key));
            args.push(n.into());
        }
    }
    let sort = params
        .get("sort")
        .filter(|s| !s.is_empty())
        .map(String::as_str)
        .unwrap_or("pa");
    let column = match sort {
        "name" => "name COLLATE NOCASE".into(),
        "club" => "club COLLATE NOCASE".into(),
        "age" | "ca" | "pa" => sort.to_string(),
        key if CATALOG.attributes.iter().any(|a| a.key == key) => format!("attr_{key}"),
        _ => return Err(Error::query("Unsupported sort column.")),
    };
    let direction = params
        .get("direction")
        .filter(|s| !s.is_empty())
        .map(String::as_str)
        .unwrap_or("desc");
    if !["asc", "desc"].contains(&direction) {
        return Err(Error::query("Invalid sort direction."));
    }
    let page = integer("page", 1, 100000)?.unwrap_or(1);
    let limit = integer("limit", 1, 250)?.unwrap_or(100);
    let condition = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    let total: i64 = db.query_row(
        &format!("SELECT COUNT(*) FROM players {condition}"),
        params_from_iter(&args),
        |r| r.get(0),
    )?;
    args.extend([limit.into(), ((page - 1) * limit).into()]);
    let mut stmt=db.prepare(&format!("SELECT id,uid,name,age,club_id,club,nations,positions,ca,pa FROM players {condition} ORDER BY {column} {direction}, ca DESC, id ASC LIMIT ? OFFSET ?"))?;
    let rows = stmt.query_map(params_from_iter(&args), |r| {
        Ok((
            r.get::<_, u32>(0)?,
            r.get::<_, u32>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i32>(3)?,
            r.get::<_, Option<u32>>(4)?,
            r.get::<_, Option<String>>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, u8>(8)?,
            r.get::<_, u8>(9)?,
        ))
    })?;
    let mut players = vec![];
    for row in rows {
        let (id, uid, name, age, club_id, club, nations, positions, ca, pa) = row?;
        let nations: Vec<u32> = serde_json::from_str(&nations)?;
        let positions: Value = serde_json::from_str(&positions)?;
        players.push(json!({"id":id,"uid":uid,"name":name,"age":age,"club_id":club_id,"club":club,"nationalities":nations.into_iter().map(nation_name).collect::<Vec<_>>(),"positions":positions,"ca":ca,"pa":pa}));
    }
    Ok(json!({"total":total,"page":page,"limit":limit,"players":players}))
}
