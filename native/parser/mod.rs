pub mod archive;
mod records;
use crate::{Error, Result};
use archive::{check, Archive};
use chrono::{Duration, NaiveDate};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::Path,
    sync::LazyLock,
    time::Instant,
};
use tokio_util::sync::CancellationToken;

pub const PARSER_VERSION: &str = "fm24-rust-1";
#[derive(Deserialize, Serialize)]
pub struct Attribute {
    pub key: String,
    pub label: String,
    pub group: String,
    pub index: usize,
    pub scale: u8,
    pub inverted: bool,
}
#[derive(Deserialize, Serialize)]
pub struct Catalog {
    pub attributes: Vec<Attribute>,
    pub positions: Vec<String>,
}
pub static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
    serde_json::from_str(include_str!("attributes.json")).expect("attribute catalog")
});

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: u32,
    pub uid: u32,
    pub name: String,
    pub full_name: String,
    pub age: i32,
    pub birth_date: String,
    pub nation_id: u16,
    pub other_nation_ids: Vec<u32>,
    pub club_id: Option<u32>,
    pub club: Option<String>,
    pub ca: u8,
    pub pa: u8,
    pub positions: Vec<String>,
    pub position_ratings: Vec<u8>,
    pub attributes: BTreeMap<String, u8>,
    pub raw_attributes: Vec<u8>,
    pub source: Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedSave {
    pub name: String,
    pub format_version: String,
    pub game_date: String,
    pub players: Vec<Player>,
    pub clubs: Vec<records::Club>,
    pub diagnostics: Value,
    pub warnings: Vec<String>,
}
fn date_of(year: u16, day: u16) -> Result<String> {
    // Match JavaScript's one-based day-of-year rollover for day 366.
    let date = NaiveDate::from_ymd_opt(year as i32, 1, 1)
        .and_then(|d| d.checked_add_signed(Duration::days(day as i64 - 1)))
        .ok_or_else(|| Error::new("UNSUPPORTED_DATE", "Invalid in-game date."))?;
    Ok(date.format("%Y-%m-%d").to_string())
}
pub fn parse_save(
    path: &Path,
    cancel: &CancellationToken,
    progress: impl Fn(u8, &str),
) -> Result<ParsedSave> {
    let start = Instant::now();
    check(cancel)?;
    progress(2, "Reading save index");
    let mut a = Archive::open(path, cancel)?;
    let info = a.member("game_info.dat", cancel)?;
    let version = info
        .get(12..20)
        .and_then(|s| std::str::from_utf8(s).ok())
        .unwrap_or("unknown");
    if version != "24.3.0+0" {
        return Err(Error::new(
            "UNSUPPORTED_VERSION",
            format!("Save format {version} is not supported. FM24 24.3 saves are required."),
        ));
    }
    progress(10, "Reading player database");
    let b = a.member("game_db.dat", cancel)?;
    if b.len() < 40 {
        return Err(Error::new(
            "TRUNCATED",
            "The player database header is incomplete.",
        ));
    }
    let (day, year) = (records::u16(&b, 36) & 511, records::u16(&b, 38));
    if !(1..=366).contains(&day) || !(2020..=2300).contains(&year) {
        return Err(Error::new(
            "UNSUPPORTED_DATE",
            "Could not read the in-game date.",
        ));
    }
    let game_date = date_of(year, day)?;
    progress(23, "Resolving player names");
    let names = records::names(&b, cancel)?;
    progress(35, "Reading player records");
    let people = records::people(&b, &names, cancel)?;
    progress(52, "Reading ability and attributes");
    let blocks = records::abilities(&b, names.end, cancel)?;
    let mut linked = vec![];
    let (mut ix, mut ambiguous, mut unbound) = (0, 0, 0);
    for person in &people {
        let first = ix;
        while ix < blocks.len() && blocks[ix].offset < person.offset {
            ix += 1;
        }
        if first == ix {
            continue;
        }
        if ix - first != 1 {
            ambiguous += 1;
            continue;
        }
        if person.id < 0 || blocks[first].owner_id != person.id as u64 {
            unbound += 1;
            continue;
        }
        linked.push((person, &blocks[first]));
    }
    progress(68, "Resolving clubs and squads");
    let clubs = records::clubs(&b, names.start, cancel)?;
    let club_map: HashMap<_, _> = clubs.iter().map(|c| (c.id, c)).collect();
    let teams = records::teams(
        &b,
        &clubs,
        names.start,
        &people
            .iter()
            .filter(|p| p.id >= 0)
            .map(|p| p.id as u32)
            .collect(),
        cancel,
    )?;
    let team_map: HashMap<_, _> = teams.iter().map(|t| (t.ordinal + 1, t)).collect();
    let mut squads = HashMap::new();
    for team in &teams {
        if let Some(club) = team.club {
            for &id in &team.members {
                if team.kind == 100 || !squads.contains_key(&id) {
                    squads.insert(id, club);
                }
            }
        }
    }
    let mut players = vec![];
    for (p, ability) in linked {
        check(cancel)?;
        let club_id = team_map
            .get(&ability.team)
            .and_then(|t| t.club)
            .or_else(|| squads.get(&(p.id as u32)).copied());
        let mut raw = ability.raw.clone();
        raw.extend_from_slice(&p.personality);
        let attributes = CATALOG
            .attributes
            .iter()
            .map(|a| {
                (
                    a.key.clone(),
                    if a.scale == 5 {
                        ((raw[a.index] as u16 + 2) / 5).clamp(1, 20) as u8
                    } else {
                        raw[a.index]
                    },
                )
            })
            .collect();
        let birth_date = date_of(p.birth_year, p.birth_day)?;
        let age = year as i32 - p.birth_year as i32 - i32::from(game_date[5..] < birth_date[5..]);
        players.push(Player { id: p.id as u32, uid: p.uid, name: p.name.clone(), full_name: p.full_name.clone(), age,
            birth_date, nation_id: p.nation, other_nation_ids: p.other_nations.clone(), club_id,
            club: club_id.and_then(|id| club_map.get(&id).map(|c| c.short_name.clone())), ca: ability.ca, pa: ability.pa,
            positions: CATALOG.positions.iter().enumerate().filter(|(i,_)| ability.positions[*i] >= 15).map(|(_,p)| p.clone()).collect(),
            position_ratings: ability.positions.clone(), attributes, raw_attributes: raw,
            source: json!({"person":p.offset,"ability":ability.offset,"identity":p.identity_offset}) });
    }
    if players.is_empty() {
        return Err(Error::new(
            "NO_PLAYERS",
            "No supported player records were found in this save.",
        ));
    }
    if players.iter().map(|p| p.id).collect::<HashSet<_>>().len() != players.len() {
        return Err(Error::new(
            "AMBIGUOUS_IDENTITIES",
            "Player identities did not validate.",
        ));
    }
    if !a.unchanged()? {
        return Err(Error::new(
            "SAVE_CHANGED",
            "The save changed during import. Wait until saving finishes, then retry.",
        ));
    }
    progress(88, "Preparing search index");
    let warnings = if ambiguous + unbound > 0 {
        vec![format!(
            "{} ambiguous player records were excluded rather than assigned uncertain ratings.",
            ambiguous + unbound
        )]
    } else {
        vec![]
    };
    let diagnostics = json!({"people":people.len(),"identities":people.iter().filter(|p|p.id>=0).count(),"abilityBlocks":blocks.len(),"players":players.len(),"ambiguous":ambiguous,"unbound":unbound,"clubs":clubs.len(),"teams":teams.len(),"clubLinks":players.iter().filter(|p|p.club.is_some()).count(),"databaseBytes":b.len(),"elapsedMs":start.elapsed().as_millis()});
    Ok(ParsedSave {
        name: a.name,
        format_version: version.into(),
        game_date,
        players,
        clubs,
        diagnostics,
        warnings,
    })
}
