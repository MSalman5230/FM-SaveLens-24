import { DatabaseSync } from "node:sqlite";
import { ATTRIBUTES } from "./parser/attributes.ts";
import type { ParsedSave } from "./parser/index.ts";
import countries from "./parser/nations.json" with { type: "json" };
export const nationName = (id: number) =>
  (countries as Record<string, string>)[id] ?? `Nation ${id}`;
export function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
export function createSnapshot(path: string, save: ParsedSave, meta: Record<string, unknown>) {
  const db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE players (
   id INTEGER PRIMARY KEY,uid INTEGER NOT NULL,name TEXT NOT NULL,full_name TEXT NOT NULL,search_name TEXT NOT NULL,
   age INTEGER,club_id INTEGER,club TEXT,nation_id INTEGER,nations TEXT NOT NULL,positions TEXT NOT NULL,position_mask INTEGER NOT NULL,
   ca INTEGER,pa INTEGER,${ATTRIBUTES.map((a) => `attr_${a.key} INTEGER`).join(",")},detail TEXT NOT NULL
  );`);
    const columns = [
      "id",
      "uid",
      "name",
      "full_name",
      "search_name",
      "age",
      "club_id",
      "club",
      "nation_id",
      "nations",
      "positions",
      "position_mask",
      "ca",
      "pa",
      ...ATTRIBUTES.map((a) => "attr_" + a.key),
      "detail",
    ];
    const insert = db.prepare(
      `INSERT INTO players (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
    );
    db.exec("BEGIN");
    for (const p of save.players) {
      const nations = [p.nationId, ...p.otherNationIds];
      const detail = { ...p, nationalities: nations.map(nationName) };
      insert.run(
        p.id,
        p.uid,
        p.name,
        p.fullName,
        normalize(p.name + " " + p.fullName + " " + p.uid),
        p.age,
        p.clubId,
        p.club,
        p.nationId,
        JSON.stringify(nations),
        JSON.stringify(p.positions),
        p.positionRatings.reduce((mask, v, i) => (v >= 15 ? mask | (1 << i) : mask), 0),
        p.ca,
        p.pa,
        ...ATTRIBUTES.map((a) => p.attributes[a.key] ?? null),
        JSON.stringify(detail),
      );
    }
    const nations = [...new Set(save.players.flatMap((p) => [p.nationId, ...p.otherNationIds]))]
      .map((id) => ({ id, name: nationName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const usedClubs = new Set(save.players.map((p) => p.clubId));
    const clubs = save.clubs
      .filter((c) => usedClubs.has(c.id))
      .map((c) => ({ id: c.id, name: c.shortName }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const metadata = {
      ...meta,
      name: save.name,
      gameDate: save.gameDate,
      formatVersion: save.formatVersion,
      playerCount: save.players.length,
      diagnostics: save.diagnostics,
      warnings: save.warnings,
      importedAt: new Date().toISOString(),
      nations,
      clubs,
    };
    db.prepare("INSERT INTO metadata VALUES (?,?)").run("snapshot", JSON.stringify(metadata));
    db.exec(
      "COMMIT; CREATE INDEX idx_players_pa ON players(pa DESC,ca DESC,id); CREATE INDEX idx_players_ca ON players(ca); CREATE INDEX idx_players_age ON players(age); CREATE INDEX idx_players_club ON players(club_id); CREATE INDEX idx_players_nation ON players(nation_id); PRAGMA optimize;",
    );
  } finally {
    db.close();
  }
}
export class QueryError extends Error {}
export function searchPlayers(db: DatabaseSync, params: URLSearchParams) {
  const where: string[] = [],
    args: (string | number)[] = [];
  const integer = (key: string, min: number, max: number) => {
    const s = params.get(key);
    if (s === null || s === "") return undefined;
    const n = Number(s);
    if (!Number.isInteger(n) || n < min || n > max) throw new QueryError(`Invalid ${key}.`);
    return n;
  };
  const q = params.get("q")?.trim();
  if (q) {
    if (q.length > 200) throw new QueryError("Search text is too long.");
    where.push("search_name LIKE ? ESCAPE '\\'");
    args.push("%" + normalize(q).replace(/[\\%_]/g, (x) => "\\" + x) + "%");
  }
  for (const [field, max] of [
    ["age", 120],
    ["ca", 200],
    ["pa", 200],
  ] as const) {
    const min = integer(field + "Min", 0, max),
      mx = integer(field + "Max", 0, max);
    if (min !== undefined && mx !== undefined && min > mx)
      throw new QueryError(`${field} minimum exceeds maximum.`);
    if (min !== undefined) {
      where.push(`${field} >= ?`);
      args.push(min);
    }
    if (mx !== undefined) {
      where.push(`${field} <= ?`);
      args.push(mx);
    }
  }
  const club = integer("club", -1, 100000);
  if (club !== undefined) {
    where.push(club === -1 ? "club_id IS NULL" : "club_id = ?");
    if (club !== -1) args.push(club);
  }
  const nation = integer("nation", 0, 255);
  if (nation !== undefined) {
    where.push("EXISTS (SELECT 1 FROM json_each(players.nations) WHERE value = ?)");
    args.push(nation);
  }
  const pos = integer("position", 0, 14);
  if (pos !== undefined) {
    where.push("(position_mask & ?) != 0");
    args.push(1 << pos);
  }
  for (const a of ATTRIBUTES) {
    const min = integer("attr_" + a.key, 1, 20);
    if (min !== undefined) {
      where.push(`attr_${a.key} >= ?`);
      args.push(min);
    }
  }
  const sort = params.get("sort") || "pa";
  const fields: Record<string, string> = {
    name: "name COLLATE NOCASE",
    age: "age",
    club: "club COLLATE NOCASE",
    ca: "ca",
    pa: "pa",
    ...Object.fromEntries(ATTRIBUTES.map((a) => [a.key, "attr_" + a.key])),
  };
  if (!fields[sort]) throw new QueryError("Unsupported sort column.");
  const dir = params.get("direction") || "desc";
  if (!["asc", "desc"].includes(dir)) throw new QueryError("Invalid sort direction.");
  const page = integer("page", 1, 100000) ?? 1,
    limit = integer("limit", 1, 250) ?? 100;
  const condition = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = Number(
    (
      db.prepare(`SELECT COUNT(*) AS total FROM players ${condition}`).get(...args) as {
        total: number;
      }
    ).total,
  );
  const rows = db
    .prepare(
      `SELECT id,uid,name,age,club_id,club,nations,positions,ca,pa FROM players ${condition} ORDER BY ${fields[sort]} ${dir}, ca DESC, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, (page - 1) * limit);
  return {
    total,
    page,
    limit,
    players: rows.map((r) => ({
      ...r,
      nationalities: (JSON.parse(String(r.nations)) as number[]).map(nationName),
      positions: JSON.parse(String(r.positions)),
      nations: undefined,
    })),
  };
}
