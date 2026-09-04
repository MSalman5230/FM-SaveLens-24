import { SaveArchive, SaveError } from "./archive.ts";
import { readNames } from "./strings.ts";
import { readPeople, readAbilities, linkAbilities } from "./people.ts";
import { readClubs } from "./clubs.ts";
import { readTeams } from "./teams.ts";
import { ATTRIBUTES, POSITIONS, displayAttribute } from "./attributes.ts";

export const PARSER_VERSION = "fm24-7";
export type Player = {
  id: number;
  uid: number;
  name: string;
  fullName: string;
  age: number;
  birthDate: string;
  nationId: number;
  otherNationIds: number[];
  clubId: number | null;
  club: string | null;
  ca: number;
  pa: number;
  positions: string[];
  positionRatings: number[];
  attributes: Record<string, number>;
  rawAttributes: number[];
  source: { person: number; ability: number; identity: number };
};
export type ParsedSave = {
  name: string;
  formatVersion: string;
  gameDate: string;
  players: Player[];
  clubs: ReturnType<typeof readClubs>;
  diagnostics: Record<string, number>;
  warnings: string[];
};
export function dateOf(year: number, day: number) {
  const date = new Date(Date.UTC(year, 0, day));
  return date.toISOString().slice(0, 10);
}
export function parseSave(
  file: string,
  onProgress: (progress: number, message: string) => void = () => {},
): ParsedSave {
  const start = Date.now();
  onProgress(2, "Reading save index");
  const a = new SaveArchive(file);
  try {
    const info = a.member("game_info.dat"),
      formatVersion = info.toString("ascii", 12, 20);
    if (formatVersion !== "24.3.0+0")
      throw new SaveError(
        "UNSUPPORTED_VERSION",
        `Save format ${formatVersion} is not supported. FM24 24.3 saves are required.`,
      );
    onProgress(10, "Reading player database");
    const b = a.member("game_db.dat");
    if (b.length < 40)
      throw new SaveError("TRUNCATED", "The player database header is incomplete.");
    const day = b.readUInt16LE(36) & 511,
      year = b.readUInt16LE(38);
    if (day < 1 || day > 366 || year < 2020 || year > 2300)
      throw new SaveError("UNSUPPORTED_DATE", "Could not read the in-game date.");
    const gameDate = dateOf(year, day);
    onProgress(23, "Resolving player names");
    const names = readNames(b);
    onProgress(35, "Reading player records");
    const people = readPeople(b, names);
    onProgress(52, "Reading ability and attributes");
    const blocks = readAbilities(b, names.end),
      { linked, ambiguous, unbound } = linkAbilities(people, blocks);
    onProgress(68, "Resolving clubs and squads");
    const clubs = readClubs(b, names.start),
      clubMap = new Map(clubs.map((c) => [c.id, c]));
    const teams = readTeams(
        b,
        clubs,
        names.start,
        new Set(people.filter((p) => p.id >= 0).map((p) => p.id)),
      ),
      teamMap = new Map(teams.map((t) => [t.ordinal + 1, t]));
    const squads = new Map<number, number>();
    for (const t of teams) {
      if (t.club === null) continue;
      for (const id of t.members) {
        if (!squads.has(id) || t.type === 100) squads.set(id, t.club);
      }
    }
    const players: Player[] = linked.map(({ person: p, ability: a }) => {
      const clubId = teamMap.get(a.team)?.club ?? squads.get(p.id) ?? null;
      const raw = [...a.raw, ...p.personality],
        attributes = Object.fromEntries(
          ATTRIBUTES.map((x) => [
            x.key,
            x.scale === 5 ? displayAttribute(raw[x.index]) : raw[x.index],
          ]),
        );
      const birthDate = dateOf(p.birthYear, p.birthDay);
      const age = year - p.birthYear - (gameDate.slice(5) < birthDate.slice(5) ? 1 : 0);
      return {
        id: p.id,
        uid: p.uid,
        name: p.name,
        fullName: p.fullName,
        age,
        birthDate,
        nationId: p.nation,
        otherNationIds: p.otherNations,
        clubId,
        club: clubId === null ? null : (clubMap.get(clubId)?.shortName ?? null),
        ca: a.ca,
        pa: a.pa,
        positions: POSITIONS.filter((_, i) => a.positions[i] >= 15),
        positionRatings: a.positions,
        attributes,
        rawAttributes: raw,
        source: { person: p.offset, ability: a.offset, identity: p.identityOffset },
      };
    });
    if (!players.length)
      throw new SaveError("NO_PLAYERS", "No supported player records were found in this save.");
    if (new Set(players.map((p) => p.id)).size !== players.length)
      throw new SaveError("AMBIGUOUS_IDENTITIES", "Player identities did not validate.");
    if (!a.unchanged())
      throw new SaveError(
        "SAVE_CHANGED",
        "The save changed during import. Wait until saving finishes, then retry.",
      );
    onProgress(88, "Preparing search index");
    const warnings: string[] = [];
    if (ambiguous + unbound)
      warnings.push(
        `${ambiguous + unbound} ambiguous player records were excluded rather than assigned uncertain ratings.`,
      );
    return {
      name: a.name,
      formatVersion,
      gameDate,
      players,
      clubs,
      diagnostics: {
        people: people.length,
        identities: people.filter((p) => p.id >= 0).length,
        abilityBlocks: blocks.length,
        players: players.length,
        ambiguous,
        unbound,
        clubs: clubs.length,
        teams: teams.length,
        clubLinks: players.filter((p) => p.club !== null).length,
        databaseBytes: b.length,
        elapsedMs: Date.now() - start,
        rssBytes: process.memoryUsage().rss,
      },
      warnings,
    };
  } finally {
    a.close();
  }
}
