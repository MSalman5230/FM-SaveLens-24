use super::archive::check;
use crate::{Error, Result};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tokio_util::sync::CancellationToken;

pub fn u32(b: &[u8], p: usize) -> u32 {
    u32::from_le_bytes(b[p..p + 4].try_into().unwrap())
}
pub fn u16(b: &[u8], p: usize) -> u16 {
    u16::from_le_bytes(b[p..p + 2].try_into().unwrap())
}
fn text(b: &[u8]) -> Option<String> {
    let s = std::str::from_utf8(b).ok()?;
    if s.chars().any(|c| c <= '\u{1f}' || c == '\u{fffd}') {
        None
    } else {
        Some(s.to_string())
    }
}
fn checkpoint(p: usize, c: &CancellationToken) -> Result<()> {
    if p & 0xffff == 0 {
        check(c)?;
    }
    Ok(())
}

pub struct Names {
    pub first: Vec<String>,
    pub last: Vec<String>,
    pub start: usize,
    pub end: usize,
}
fn pool(
    b: &[u8],
    start: usize,
    cancel: &CancellationToken,
) -> Result<Option<(Vec<String>, usize)>> {
    if start + 16 >= b.len() {
        return Ok(None);
    }
    let count = u32(b, start) as usize;
    if !(1..=3_000_000).contains(&count) {
        return Ok(None);
    }
    let mut names = Vec::new();
    let mut p = start + 4;
    for id in 0..count {
        if id % 4096 == 0 {
            check(cancel)?;
        }
        if p + 8 > b.len() || u32(b, p) as usize != id {
            return Ok(None);
        }
        let n = u32(b, p + 4) as usize;
        if n > 512 || p + 8 + n > b.len() {
            return Ok(None);
        }
        let Some(s) = text(&b[p + 8..p + 8 + n]) else {
            return Ok(None);
        };
        names.push(s);
        p += 8 + n;
    }
    Ok(Some((names, p)))
}
pub fn names(b: &[u8], cancel: &CancellationToken) -> Result<Names> {
    for p in 0..b.len().saturating_sub(40) {
        checkpoint(p, cancel)?;
        if b[p + 4..p + 8] != [0; 4] {
            continue;
        }
        let count = u32(b, p);
        if !(10000..=3_000_000).contains(&count) {
            continue;
        }
        let n = u32(b, p + 8) as usize;
        if !(1..=100).contains(&n) || p + 16 + n > b.len() || u32(b, p + 12 + n) != 1 {
            continue;
        }
        let Some((first, end)) = pool(b, p, cancel)? else {
            continue;
        };
        let Some((last, end)) = pool(b, end, cancel)? else {
            continue;
        };
        if last.len() < 10000 {
            continue;
        }
        let Some((_, end)) = pool(b, end, cancel)? else {
            continue;
        };
        return Ok(Names {
            first,
            last,
            start: p,
            end,
        });
    }
    Err(Error::new(
        "UNSUPPORTED_NAMES",
        "Could not locate the FM24 name tables in this save.",
    ))
}

pub struct Person {
    pub offset: usize,
    pub end: usize,
    pub id: i64,
    pub uid: u32,
    pub name: String,
    pub full_name: String,
    pub birth_day: u16,
    pub birth_year: u16,
    pub nation: u16,
    pub personality: Vec<u8>,
    pub other_nations: Vec<u32>,
    pub identity_offset: usize,
}
#[derive(Clone)]
struct Identity {
    offset: usize,
    id: u32,
    uid: u32,
}
pub fn people(b: &[u8], names: &Names, cancel: &CancellationToken) -> Result<Vec<Person>> {
    let mut people = Vec::new();
    let mut p = names.end;
    while p < b.len().saturating_sub(100) {
        checkpoint(p, cancel)?;
        let start = p;
        p += 1;
        if b[start + 4] != 0
            || b[start + 9] != 0
            || b[start + 14] != 0
            || b[start + 17] != 0
            || b[start + 18] != 0
        {
            continue;
        }
        let (f, l, n) = (
            u32(b, start),
            u32(b, start + 5),
            u32(b, start + 15) as usize,
        );
        if (f != u32::MAX && f as usize >= names.first.len())
            || (l != u32::MAX && l as usize >= names.last.len())
            || n > 200
        {
            continue;
        }
        let end = start + 19 + n;
        if end + 45 > b.len() {
            continue;
        }
        let (day, year, nation) = (u16(b, end), u16(b, end + 2), u16(b, end + 9));
        if !(1..=366).contains(&day) || !(1850..=2300).contains(&year) || nation > 255 {
            continue;
        }
        if b[end + 11..end + 17] != [0; 6]
            || !b[end + 17..end + 25].iter().all(|v| (1..=20).contains(v))
        {
            continue;
        }
        let Some(full_name) = text(&b[start + 19..end]) else {
            continue;
        };
        let first = names
            .first
            .get(f as usize)
            .map(String::as_str)
            .unwrap_or("");
        let last = names.last.get(l as usize).map(String::as_str).unwrap_or("");
        let name = format!("{first} {last}").trim().to_string();
        let name = if name.is_empty() {
            full_name.clone()
        } else {
            name
        };
        if name.is_empty() {
            continue;
        }
        people.push(Person {
            offset: start,
            end,
            id: -1,
            uid: u32::MAX,
            name: name.clone(),
            full_name: if full_name.is_empty() {
                name
            } else {
                full_name
            },
            birth_day: day,
            birth_year: year,
            nation,
            personality: b[end + 17..end + 25].to_vec(),
            other_nations: vec![],
            identity_offset: 0,
        });
        p = end + 25;
    }
    if names.end + 4 > b.len() {
        return Err(Error::new("TRUNCATED", "The person table is incomplete."));
    }
    let max_id = u32(b, names.end) as u64 + 1;
    let mut identities = Vec::new();
    for p in names.end + 7..b.len().saturating_sub(12) {
        checkpoint(p, cancel)?;
        if b[p - 1] != 0
            || b[p - 2] != 0
            || b[p - 3] != 0
            || b[p - 7] & 7 > 2
            || ![0, 1, 4, 5].contains(&b[p - 4])
        {
            continue;
        }
        let (id, uid) = (u32(b, p), u32(b, p + 4));
        if id as u64 >= max_id || uid == 0 || uid == u32::MAX {
            continue;
        }
        if uid != u32(b, p + 8) {
            if p < 12 {
                continue;
            }
            let (day, year, source) = (u16(b, p - 12) & 511, u16(b, p - 10), u32(b, p + 8));
            if !(1..=366).contains(&day)
                || !(1900..=2300).contains(&year)
                || b[p - 6] & 0x85 != 0
                || b[p - 6] & 0x60 == 0
                || source < 1000
                || source == u32::MAX
            {
                continue;
            }
        }
        if id & 255 == 0 && uid & 255 == 0 && u32(b, p + 5) == u32(b, p + 9) {
            continue;
        }
        identities.push(Identity { offset: p, id, uid });
    }
    // Reproduce the strictly ascending entity chain, including tie replacement.
    let mut tails: Vec<u32> = vec![];
    let mut indices: Vec<usize> = vec![];
    let mut prev = vec![None; identities.len()];
    for (i, identity) in identities.iter().enumerate() {
        if i % 4096 == 0 {
            check(cancel)?;
        }
        let pos = tails.partition_point(|id| *id < identity.id);
        prev[i] = pos.checked_sub(1).map(|j| indices[j]);
        if pos == tails.len() {
            tails.push(identity.id);
            indices.push(i);
        } else {
            tails[pos] = identity.id;
            indices[pos] = i;
        }
    }
    let mut ordered = vec![];
    let mut ix = indices.last().copied();
    while let Some(i) = ix {
        ordered.push(identities[i].clone());
        ix = prev[i];
    }
    ordered.reverse();
    let mut j = 0;
    for i in 0..people.len() {
        if i % 4096 == 0 {
            check(cancel)?;
        }
        let end = people.get(i + 1).map_or(b.len(), |p| p.offset);
        let person = &mut people[i];
        while j < ordered.len() && ordered[j].offset < person.end + 25 {
            j += 1;
        }
        let Some(identity) = ordered.get(j).filter(|x| x.offset < end) else {
            continue;
        };
        person.id = identity.id as i64;
        person.uid = identity.uid;
        person.identity_offset = identity.offset;
        let count = b[person.end + 34] as usize;
        if b[person.end + 33] == 1 && person.end + 35 + count * 16 <= identity.offset {
            for k in 0..count {
                let p = person.end + 35 + k * 16;
                let n = u32(b, p);
                if n < 256
                    && n != person.nation as u32
                    && b[p + 4..p + 8] == [0; 4]
                    && b[p + 10] == 8
                    && [9, 70].contains(&b[p + 11])
                    && !person.other_nations.contains(&n)
                {
                    person.other_nations.push(n);
                }
            }
        }
    }
    Ok(people)
}

pub struct Ability {
    pub offset: usize,
    pub owner_id: u64,
    pub ca: u8,
    pub pa: u8,
    pub team: u32,
    pub positions: Vec<u8>,
    pub raw: Vec<u8>,
}
pub fn abilities(b: &[u8], start: usize, cancel: &CancellationToken) -> Result<Vec<Ability>> {
    let mut blocks = vec![];
    let mut p = start + 57;
    while p < b.len().saturating_sub(54) {
        checkpoint(p, cancel)?;
        let at = p;
        p += 1;
        if b[at - 37] != 0 || b[at - 35] != 0 {
            continue;
        }
        let (ca, pa) = (b[at - 38], b[at - 36]);
        if !(1..=200).contains(&ca) || !(1..=200).contains(&pa) {
            continue;
        }
        let positions = &b[at - 15..at];
        if !positions.iter().all(|v| (1..=20).contains(v))
            || !positions.contains(&20)
            || !b[at..at + 54].iter().all(|v| (1..=100).contains(v))
        {
            continue;
        }
        let (uid, source) = (u32(b, at - 53), u32(b, at - 49));
        if uid == 0 || uid == u32::MAX || source == 0 || source == u32::MAX {
            continue;
        }
        blocks.push(Ability {
            offset: at,
            owner_id: u32(b, at - 57) as u64 + 1,
            ca,
            pa,
            team: u32(b, at - 23),
            positions: positions.to_vec(),
            raw: b[at..at + 54].to_vec(),
        });
        p = at + 54;
    }
    Ok(blocks)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Club {
    pub id: u32,
    pub uid: u32,
    pub name: String,
    pub short_name: String,
    pub nation: u32,
    pub offset: usize,
}
pub fn clubs(b: &[u8], end: usize, cancel: &CancellationToken) -> Result<Vec<Club>> {
    let mut clubs = vec![];
    let mut p = 0;
    while p + 50 < end {
        checkpoint(p, cancel)?;
        let at = p;
        p += 1;
        if b[at + 12] != 0 || b[at + 17..at + 21] != [255; 4] {
            continue;
        }
        let nation = u32(b, at + 13);
        if nation > 255 || u32(b, at + 25) != nation {
            continue;
        }
        let (uid, id) = (u32(b, at + 4), u32(b, at));
        if uid == 0 || uid == u32::MAX || uid != u32(b, at + 8) || id > 100000 {
            continue;
        }
        let n = u32(b, at + 39) as usize;
        if !(2..=200).contains(&n) || at + 47 + n >= end {
            continue;
        }
        let sn = u32(b, at + 43 + n) as usize;
        if !(1..=100).contains(&sn) || at + 47 + n + sn > end {
            continue;
        }
        let Some(name) = text(&b[at + 43..at + 43 + n]) else {
            continue;
        };
        let Some(short_name) = text(&b[at + 47 + n..at + 47 + n + sn]) else {
            continue;
        };
        clubs.push(Club {
            id,
            uid,
            nation,
            name,
            short_name,
            offset: at,
        });
        p = at + 47 + n + sn;
    }
    Ok(clubs)
}

pub struct Team {
    pub club: Option<u32>,
    pub ordinal: u32,
    pub kind: u8,
    pub members: Vec<u32>,
}
struct Head {
    offset: usize,
    owner: u32,
    ordinal: u32,
    uid: u32,
    typed: bool,
    kind: u8,
    flag: u8,
}
pub fn teams(
    b: &[u8],
    clubs: &[Club],
    end: usize,
    valid: &HashSet<u32>,
    cancel: &CancellationToken,
) -> Result<Vec<Team>> {
    let club_map: HashMap<_, _> = clubs.iter().map(|c| (c.id, c)).collect();
    let mut heads = vec![];
    let mut p = 4;
    while p < end.saturating_sub(70) {
        checkpoint(p, cancel)?;
        let at = p;
        p += 1;
        if b[at + 26] != 10 || b[at + 4..at + 14] != [0; 10] {
            continue;
        }
        let (owner, ordinal, uid) = (u32(b, at), u32(b, at + 14), u32(b, at + 18));
        if owner > 100000 || ordinal > 500000 || uid == 0 {
            continue;
        }
        let typed =
            b[at - 4] == 1 && b[at - 2] == 255 && [18, 19, 20, 21, 23, 100].contains(&b[at - 3]);
        let matched = club_map.get(&owner).is_some_and(|c| c.uid == uid) && u32(b, at + 22) == uid;
        if !typed && !matched {
            continue;
        }
        heads.push(Head {
            offset: at,
            owner,
            ordinal,
            uid,
            typed,
            kind: if typed { b[at - 3] } else { 100 },
            flag: if typed { b[at - 1] } else { 0 },
        });
        p = at + 26;
    }
    let mut teams = vec![];
    for (i, h) in heads.iter().enumerate() {
        check(cancel)?;
        let limit = heads
            .get(i + 1)
            .map_or(end, |h| h.offset)
            .min(h.offset + 10000);
        let mut club = None;
        if club_map.get(&h.owner).is_some_and(|c| c.uid == h.uid) {
            club = Some(h.owner);
        } else if h.typed && !(h.kind == 100 && h.flag & 32 != 0) && h.owner > 256 {
            let id = if [20, 23].contains(&h.kind) {
                h.owner - 1
            } else {
                h.owner
            };
            if club_map.contains_key(&id) {
                club = Some(id);
            }
        }
        let mut members = vec![];
        for p in h.offset + 30..limit.saturating_sub(14) {
            if b[p] != 255 || u32(b, p) != u32::MAX {
                continue;
            }
            let count = u16(b, p + 4) as usize;
            if !(1..=150).contains(&count) || p + 6 + count * 4 + 8 > limit {
                continue;
            }
            let ids: Vec<_> = (0..count).map(|k| u32(b, p + 6 + k * 4)).collect();
            let set: HashSet<_> = ids.iter().copied().collect();
            if set.len() != count || ids.iter().any(|&id| id > 3_000_000) {
                continue;
            }
            let (captain, vice) = (u32(b, p + 6 + count * 4), u32(b, p + 10 + count * 4));
            if (captain != u32::MAX && !set.contains(&captain))
                || (vice != u32::MAX && !set.contains(&vice))
            {
                continue;
            }
            if (ids.iter().filter(|id| valid.contains(id)).count() as f64)
                < (count as f64 * 0.7).max(1.0)
            {
                continue;
            }
            members = ids;
            break;
        }
        teams.push(Team {
            club,
            ordinal: h.ordinal,
            kind: h.kind,
            members,
        });
    }
    Ok(teams)
}
