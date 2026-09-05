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
    player_with_system(db, id, &crate::rating_systems::BUILTIN)
}
pub fn player_with_system(
    db: &Connection,
    id: u32,
    system: &crate::rating_systems::RatingSystem,
) -> Result<Value> {
    use rusqlite::OptionalExtension;
    let raw: Option<String> = db
        .query_row("SELECT detail FROM players WHERE id=?", [id], |r| r.get(0))
        .optional()?;
    let raw = raw.ok_or_else(|| Error::new("NOT_FOUND", "Player not found."))?;
    let mut detail: Value = serde_json::from_str(&raw)?;
    detail["roleRatings"] = json!(system
        .roles
        .iter()
        .map(|role| system.rate_role(role, &detail["attributes"]))
        .collect::<Vec<_>>());
    system.tag(&mut detail);
    Ok(detail)
}
pub fn search(db: &Connection, query: &str) -> Result<Value> {
    search_with_system(db, query, &crate::rating_systems::BUILTIN)
}
pub fn search_with_system(
    db: &Connection,
    query: &str,
    system: &crate::rating_systems::RatingSystem,
) -> Result<Value> {
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
    let role = params
        .get("role")
        .filter(|s| !s.is_empty())
        .map(|id| system.find(id))
        .transpose()?;
    let score_expression = role.map(|r| r.sql_score());
    let mut displayed_roles = vec![];
    if let Some(ids) = params.get("roles").filter(|s| !s.is_empty()) {
        for id in ids.split(',') {
            let displayed = system.find(id)?;
            if !displayed_roles
                .iter()
                .any(|r: &&crate::roles::Role| r.id == displayed.id)
            {
                displayed_roles.push(displayed);
            }
        }
    }
    if let Some(min) = params.get("roleMin").filter(|s| !s.is_empty()) {
        let expression = score_expression
            .as_ref()
            .ok_or_else(|| Error::query("Select a role before setting a minimum role rating."))?;
        let min = min
            .trim()
            .parse::<f64>()
            .map_err(|_| Error::query("Invalid roleMin."))?;
        if !min.is_finite() || !(0.0..=100.0).contains(&min) {
            return Err(Error::query("Invalid roleMin."));
        }
        clauses.push(format!("{expression} >= ?"));
        args.push(min.into());
    }
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
    let position_match = params
        .get("positionMatch")
        .map(String::as_str)
        .unwrap_or("and");
    if !["and", "or"].contains(&position_match) {
        return Err(Error::query(
            "Invalid positionMatch. Expected 'and' or 'or'.",
        ));
    }
    if let Some(positions) = params.get("position").filter(|s| !s.is_empty()) {
        let mut mask = 0i64;
        for id in positions.split(',') {
            let id = id.trim();
            if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
                return Err(Error::query("Invalid position."));
            }
            let index = id
                .parse::<usize>()
                .map_err(|_| Error::query("Invalid position."))?;
            if index >= CATALOG.positions.len() {
                return Err(Error::query("Invalid position."));
            }
            mask |= 1i64 << index;
        }
        if position_match == "and" {
            clauses.push("(position_mask & ?) = ?".into());
            args.push(mask.into());
            args.push(mask.into());
        } else {
            clauses.push("(position_mask & ?) != 0".into());
            args.push(mask.into());
        }
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
        "roleRating" => {
            if role.is_none() {
                return Err(Error::query("Select a role before sorting by role rating."));
            }
            "roleRating".into()
        }
        key if key.starts_with("role:") => system.find(&key[5..])?.sql_score(),
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
    let score_select = score_expression.as_deref().unwrap_or("NULL");
    let null_order = if sort == "roleRating" || sort.starts_with("role:") {
        " NULLS LAST"
    } else {
        ""
    };
    let mut stmt=db.prepare(&format!("SELECT id,uid,name,age,club_id,club,nations,positions,ca,pa,{score_select} AS roleRating FROM players {condition} ORDER BY {column} {direction}{null_order}, ca DESC, id ASC LIMIT ? OFFSET ?"))?;
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
            r.get::<_, Option<f64>>(10)?,
        ))
    })?;
    let mut players = vec![];
    for row in rows {
        let (id, uid, name, age, club_id, club, nations, positions, ca, pa, role_rating) = row?;
        let nations: Vec<u32> = serde_json::from_str(&nations)?;
        let positions: Value = serde_json::from_str(&positions)?;
        let mut player = json!({"id":id,"uid":uid,"name":name,"age":age,"club_id":club_id,"club":club,"nationalities":nations.into_iter().map(nation_name).collect::<Vec<_>>(),"positions":positions,"ca":ca,"pa":pa});
        if role.is_some() {
            player["roleRating"] = json!(role_rating);
        }
        players.push(player);
    }
    // Extra display columns are evaluated only for this page. Sorting/filtering
    // above still evaluates its selected role across the entire matching set.
    if !displayed_roles.is_empty() && !players.is_empty() {
        let expressions = displayed_roles
            .iter()
            .map(|r| r.sql_score())
            .collect::<Vec<_>>()
            .join(",");
        let placeholders = vec!["?"; players.len()].join(",");
        let ids = players.iter().map(|p| p["id"].as_u64().unwrap() as i64);
        let mut scores = db.prepare(&format!(
            "SELECT id,{expressions} FROM players WHERE id IN ({placeholders})"
        ))?;
        let by_player = scores
            .query_map(params_from_iter(ids), |row| {
                let mut values = serde_json::Map::new();
                for (i, role) in displayed_roles.iter().enumerate() {
                    values.insert(role.id.clone(), json!(row.get::<_, Option<f64>>(i + 1)?));
                }
                Ok((row.get::<_, u32>(0)?, Value::Object(values)))
            })?
            .collect::<std::result::Result<HashMap<_, _>, _>>()?;
        attach_role_scores(&mut players, &by_player, &displayed_roles);
    }
    let mut result = json!({"total":total,"page":page,"limit":limit,"players":players});
    system.tag(&mut result);
    Ok(result)
}

fn attach_role_scores(
    players: &mut [Value],
    by_player: &HashMap<u32, Value>,
    displayed_roles: &[&crate::roles::Role],
) {
    for player in players {
        let id = player["id"].as_u64().unwrap() as u32;
        player["roleScores"] = by_player.get(&id).cloned().unwrap_or_else(|| {
            Value::Object(
                displayed_roles
                    .iter()
                    .map(|role| (role.id.clone(), Value::Null))
                    .collect(),
            )
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_role_score_rows_preserve_players_and_return_null_for_every_requested_role() {
        let roles = [
            crate::roles::find("af-attack").unwrap(),
            crate::roles::find("tf-support").unwrap(),
        ];
        let scores = json!({"af-attack": 78.54321, "tf-support": null});
        let by_player = HashMap::from([(7, scores.clone())]);
        let mut players = vec![json!({"id": 8, "name": "Missing"}), json!({"id": 7})];

        attach_role_scores(&mut players, &by_player, &roles);

        assert_eq!(
            players,
            vec![
                json!({"id": 8, "name": "Missing", "roleScores": {"af-attack": null, "tf-support": null}}),
                json!({"id": 7, "roleScores": scores}),
            ]
        );
    }
}
