//! The source snapshot is attached read-only to an in-memory connection.
//! Dropping the session releases all derived ratings and ordered IDs.
use super::*;
use crate::rating_systems::RatingSystem;
use std::{collections::VecDeque, ops::Range};

pub struct SearchSession {
    db: Connection,
    system: RatingSystem,
    orders: OrderCache,
}

impl SearchSession {
    pub fn open(path: &Path, system: &RatingSystem) -> Result<Self> {
        let db = Connection::open_in_memory()?;
        let mut source = url::Url::from_file_path(path)
            .map_err(|_| Error::query("Snapshot path must be absolute."))?;
        source.query_pairs_mut().append_pair("mode", "ro");
        db.execute("ATTACH DATABASE ? AS snapshot", [source.as_str()])?;
        db.execute_batch("ATTACH DATABASE ':memory:' AS session")?;
        let transaction = db.unchecked_transaction()?;
        let mut best: HashMap<u32, Option<(usize, f64)>> = HashMap::new();
        for (batch_index, batch) in system.roles.chunks(64).enumerate() {
            let expressions = batch
                .iter()
                .enumerate()
                .map(|(i, role)| format!("{} AS score_{i}", role.sql_score()))
                .collect::<Vec<_>>()
                .join(",");
            transaction.execute_batch(&format!(
                "CREATE TABLE session.ratings_{batch_index} AS SELECT id,{expressions} FROM players;
                 CREATE UNIQUE INDEX session.ratings_{batch_index}_id ON ratings_{batch_index}(id);"
            ))?;
            let mut stmt =
                transaction.prepare(&format!("SELECT * FROM session.ratings_{batch_index}"))?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let entry = best.entry(row.get(0)?).or_default();
                for (i, role) in batch.iter().enumerate() {
                    if let Some(score) = row.get::<_, Option<f64>>(i + 1)? {
                        if entry.is_none_or(|(previous, high)| {
                            score > high || (score == high && role.id < system.roles[previous].id)
                        }) {
                            *entry = Some((batch_index * 64 + i, score));
                        }
                    }
                }
            }
        }
        transaction.execute_batch(
            "CREATE TABLE session.best (id INTEGER PRIMARY KEY,role_id TEXT,score REAL)",
        )?;
        {
            let mut insert = transaction.prepare("INSERT INTO session.best VALUES (?,?,?)")?;
            for (id, best) in best {
                insert.execute(rusqlite::params![
                    id,
                    best.map(|(i, _)| &system.roles[i].id),
                    best.map(|(_, score)| score)
                ])?;
            }
        }
        transaction.commit()?;
        Ok(Self {
            db,
            system: system.clone(),
            orders: OrderCache::default(),
        })
    }

    pub fn search(&mut self, query: &str) -> Result<Value> {
        search_impl(&self.db, query, &self.system, Some(&mut self.orders))
    }

    /// Diagnostic counters for performance verification, without timing assertions.
    pub fn sort_builds(&self) -> usize {
        self.orders.builds
    }

    /// SQLite page allocation plus ordered-ID buffers, not total process RSS.
    pub fn memory_bytes(&self) -> Result<u64> {
        let pages: u64 = self
            .db
            .query_row("PRAGMA session.page_count", [], |r| r.get(0))?;
        let size: u64 = self
            .db
            .query_row("PRAGMA session.page_size", [], |r| r.get(0))?;
        Ok(pages * size
            + self
                .orders
                .entries
                .iter()
                .map(|(_, order)| {
                    (order.ids.capacity() * std::mem::size_of::<u32>()
                        + order.groups.capacity() * std::mem::size_of::<Range<usize>>())
                        as u64
                })
                .sum::<u64>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derived_database_is_writable_but_source_is_enforced_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("source.sqlite");
        let source = Connection::open(&path).unwrap();
        let columns = CATALOG
            .attributes
            .iter()
            .map(|a| format!("attr_{} INTEGER", a.key))
            .collect::<Vec<_>>()
            .join(",");
        source.execute_batch(&format!("CREATE TABLE players (id INTEGER PRIMARY KEY,{columns}); INSERT INTO players(id) VALUES (1)")).unwrap();
        drop(source);
        let session = SearchSession::open(&path, &crate::rating_systems::BUILTIN).unwrap();
        assert!(session
            .db
            .execute("DELETE FROM snapshot.players", [])
            .is_err());
        assert_eq!(
            session
                .db
                .query_row("SELECT score FROM session.best WHERE id=1", [], |r| r
                    .get::<_, Option<f64>>(0))
                .unwrap(),
            None
        );
        session
            .db
            .execute("UPDATE session.best SET score=10 WHERE id=1", [])
            .unwrap();
    }
}

pub(super) fn score_column(system: &RatingSystem, role: &crate::roles::Role) -> String {
    let index = system
        .roles
        .iter()
        .position(|r| r.id == role.id)
        .expect("validated role");
    format!(
        "(SELECT score_{} FROM session.ratings_{} WHERE id=players.id)",
        index % 64,
        index / 64
    )
}

#[derive(Default)]
pub(super) struct OrderCache {
    entries: VecDeque<(String, OrderedPlayers)>,
    builds: usize,
}

impl OrderCache {
    pub(super) fn get(
        &mut self,
        db: &Connection,
        condition: &str,
        args: &[SqlValue],
        column: &str,
        nulls_last: bool,
    ) -> Result<&OrderedPlayers> {
        // The SQL and bound values come from the shared validated query parser.
        let key = format!("{condition}\n{args:?}\n{column}\n{nulls_last}");
        if let Some(index) = self.entries.iter().position(|(stored, _)| *stored == key) {
            let entry = self.entries.remove(index).unwrap();
            self.entries.push_back(entry);
        } else {
            let mut stmt = db.prepare(&format!(
                "SELECT id,{column} FROM players {condition} ORDER BY {column} ASC,ca DESC,id ASC"
            ))?;
            let mut rows = stmt.query(params_from_iter(args))?;
            let mut order = OrderedPlayers {
                ids: vec![],
                groups: vec![],
                null_group: None,
                nulls_last,
            };
            let mut previous = None;
            while let Some(row) = rows.next()? {
                let value: SqlValue = row.get(1)?;
                let equal = match (&previous, &value) {
                    (Some(SqlValue::Text(a)), SqlValue::Text(b))
                        if column.ends_with("COLLATE NOCASE") =>
                    {
                        a.split('\0')
                            .next()
                            .unwrap()
                            .eq_ignore_ascii_case(b.split('\0').next().unwrap())
                            && a.len() == b.len()
                    }
                    (Some(a), b) => a == b,
                    _ => false,
                };
                if !equal {
                    if value == SqlValue::Null {
                        order.null_group = Some(order.groups.len());
                    }
                    order.groups.push(order.ids.len()..order.ids.len());
                }
                order.ids.push(row.get(0)?);
                order.groups.last_mut().unwrap().end += 1;
                previous = Some(value);
            }
            self.builds += 1;
            if self.entries.len() == 32 {
                self.entries.pop_front();
            }
            self.entries.push_back((key, order));
        }
        Ok(&self.entries.back().unwrap().1)
    }
}

pub(super) struct OrderedPlayers {
    ids: Vec<u32>,
    groups: Vec<Range<usize>>,
    null_group: Option<usize>,
    nulls_last: bool,
}

impl OrderedPlayers {
    pub(super) fn len(&self) -> usize {
        self.ids.len()
    }

    pub(super) fn page(&self, descending: bool, page: i64, limit: i64) -> Vec<u32> {
        let groups: Box<dyn Iterator<Item = usize>> = if descending {
            Box::new((0..self.groups.len()).rev())
        } else {
            Box::new(0..self.groups.len())
        };
        let null_at_end = self.null_group.filter(|_| self.nulls_last);
        let mut skip = ((page - 1) * limit) as usize;
        let mut ids = Vec::with_capacity(limit as usize);
        for index in groups
            .filter(|index| Some(*index) != null_at_end)
            .chain(null_at_end)
        {
            let group = &self.groups[index];
            if skip >= group.len() {
                skip -= group.len();
                continue;
            }
            let start = group.start + skip;
            let end = group.end.min(start + limit as usize - ids.len());
            ids.extend_from_slice(&self.ids[start..end]);
            skip = 0;
            if ids.len() == limit as usize {
                break;
            }
        }
        ids
    }
}
