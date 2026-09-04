import type { Club } from "./clubs.ts";
export type Team = {
  offset: number;
  club: number | null;
  ordinal: number;
  type: number;
  members: number[];
};
export function readTeams(b: Buffer, clubs: Club[], end: number, validPeople: Set<number>) {
  const clubMap = new Map(clubs.map((c) => [c.id, c]));
  const heads: {
    offset: number;
    owner: number;
    ordinal: number;
    uid: number;
    typed: boolean;
    type: number;
    flag: number;
  }[] = [];
  for (let p = 4; p < end - 70; p++) {
    if (
      b[p + 26] !== 10 ||
      b[p + 4] ||
      b[p + 5] ||
      b[p + 6] ||
      b[p + 7] ||
      b[p + 8] ||
      b[p + 9] ||
      b[p + 10] ||
      b[p + 11] ||
      b[p + 12] ||
      b[p + 13]
    )
      continue;
    const owner = b.readUInt32LE(p),
      ordinal = b.readUInt32LE(p + 14),
      uid = b.readUInt32LE(p + 18);
    if (owner > 100000 || ordinal > 500000 || !uid) continue;
    const typed =
      b[p - 4] === 1 && b[p - 2] === 255 && [18, 19, 20, 21, 23, 100].includes(b[p - 3]);
    const club = clubMap.get(owner),
      matched = club?.uid === uid && b.readUInt32LE(p + 22) === uid;
    if (!typed && !matched) continue;
    heads.push({
      offset: p,
      owner,
      ordinal,
      uid,
      typed,
      type: typed ? b[p - 3] : 100,
      flag: typed ? b[p - 1] : 0,
    });
    p += 25;
  }
  const teams: Team[] = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i],
      limit = Math.min(heads[i + 1]?.offset ?? end, h.offset + 10000);
    let club: number | null = null;
    if (clubMap.get(h.owner)?.uid === h.uid) club = h.owner;
    else if (h.typed && !(h.type === 100 && h.flag & 32) && h.owner > 256) {
      const id = [20, 23].includes(h.type) ? h.owner - 1 : h.owner;
      if (clubMap.has(id)) club = id;
    }
    const members: number[] = [];
    for (let p = h.offset + 30; p + 14 < limit; p++) {
      if (b[p] !== 255 || b.readUInt32LE(p) !== 0xffffffff) continue;
      const count = b.readUInt16LE(p + 4);
      if (!count || count > 150 || p + 6 + count * 4 + 8 > limit) continue;
      const ids = Array.from({ length: count }, (_, k) => b.readUInt32LE(p + 6 + k * 4));
      const set = new Set(ids);
      if (set.size !== count || ids.some((id) => id > 3000000)) continue;
      const captain = b.readUInt32LE(p + 6 + count * 4),
        vice = b.readUInt32LE(p + 10 + count * 4);
      if ((captain !== 0xffffffff && !set.has(captain)) || (vice !== 0xffffffff && !set.has(vice)))
        continue;
      if (ids.filter((id) => validPeople.has(id)).length < Math.max(1, count * 0.7)) continue;
      members.push(...ids);
      break;
    }
    teams.push({ offset: h.offset, club, ordinal: h.ordinal, type: h.type, members });
  }
  return teams;
}
