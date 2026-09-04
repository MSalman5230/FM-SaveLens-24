import type { Names } from "./strings.ts";
export type Person = {
  offset: number;
  end: number;
  id: number;
  uid: number;
  name: string;
  fullName: string;
  birthDay: number;
  birthYear: number;
  nation: number;
  personality: number[];
  otherNations: number[];
  identityOffset: number;
};
export type AbilityBlock = {
  offset: number;
  ownerId: number;
  ca: number;
  pa: number;
  team: number;
  positions: number[];
  raw: number[];
};

export function readPeople(b: Buffer, names: Names) {
  const people: Person[] = [];
  for (let p = names.end; p < b.length - 100; p++) {
    if (b[p + 4] || b[p + 9] || b[p + 14] || b[p + 17] || b[p + 18]) continue;
    const f = b.readUInt32LE(p),
      l = b.readUInt32LE(p + 5),
      n = b.readUInt32LE(p + 15);
    if ((f !== 0xffffffff && f >= names.first.length) || (l !== 0xffffffff && l >= names.last.length) || n > 200) continue;
    const end = p + 19 + n;
    if (end + 45 > b.length) continue;
    const day = b.readUInt16LE(end),
      year = b.readUInt16LE(end + 2),
      nation = b.readUInt16LE(end + 9);
    if (day < 1 || day > 366 || year < 1850 || year > 2300 || nation > 255) continue;
    if (
      !b.subarray(end + 11, end + 17).every((v) => v === 0) ||
      !b.subarray(end + 17, end + 25).every((v) => v >= 1 && v <= 20)
    )
      continue;
    const fullName = b.toString("utf8", p + 19, end);
    if (/[\u0000-\u001f\ufffd]/.test(fullName)) continue;
    const name = `${names.first[f]??''} ${names.last[l]??''}`.trim() || fullName;
    if (!name) continue;
    people.push({
      offset: p,
      end,
      id: -1,
      uid: -1,
      name,
      fullName: fullName || name,
      birthDay: day,
      birthYear: year,
      nation,
      personality: Array.from(b.subarray(end + 17, end + 25)),
      otherNations: [],
      identityOffset: 0,
    });
    p = end + 24;
  }
  const maxId = b.readUInt32LE(names.end) + 1;
  const identities: { offset: number; id: number; uid: number }[] = [];
  for (let p = names.end + 7; p < b.length - 12; p++) {
    if (b[p - 1] || b[p - 2] || b[p - 3] || (b[p - 7] & 7) > 2 || ![0, 1, 4, 5].includes(b[p - 4]))
      continue;
    const id = b.readUInt32LE(p),
      uid = b.readUInt32LE(p + 4);
    if (id >= maxId || !uid || uid === 0xffffffff) continue;
    // Edited databases may retain a different source UID after the public UID.
    // Accept that variant only with the dated person header and known flags;
    // ordered entity IDs and the ability owner's ID still have to agree.
    if (uid !== b.readUInt32LE(p + 8)) {
      if (p < 12) continue;
      const day = b.readUInt16LE(p - 12) & 511,
        year = b.readUInt16LE(p - 10),
        sourceUid = b.readUInt32LE(p + 8);
      if (
        day < 1 ||
        day > 366 ||
        year < 1900 ||
        year > 2300 ||
        (b[p - 6] & 0x85) !== 0 ||
        (b[p - 6] & 0x60) === 0 ||
        sourceUid < 1000 ||
        sourceUid === 0xffffffff
      )
        continue;
    }
    // Reject a one-byte-early interpretation of the same identity.
    if ((id & 255) === 0 && (uid & 255) === 0 && b.readUInt32LE(p + 5) === b.readUInt32LE(p + 9))
      continue;
    identities.push({ offset: p, id, uid });
  }
  // The person entity table is serialized in ID order. The longest ascending
  // chain removes repeated-UID coincidences in contracts and relationship data.
  const tails: number[] = [],
    tailIndices: number[] = [],
    prev = new Int32Array(identities.length).fill(-1);
  for (let i = 0; i < identities.length; i++) {
    const id = identities[i].id;
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < id) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo ? tailIndices[lo - 1] : -1;
    tails[lo] = id;
    tailIndices[lo] = i;
  }
  const ordered: typeof identities = [];
  let ix = tailIndices.at(-1) ?? -1;
  while (ix >= 0) {
    ordered.push(identities[ix]);
    ix = prev[ix];
  }
  ordered.reverse();
  let j = 0;
  for (let i = 0; i < people.length; i++) {
    const person = people[i],
      end = people[i + 1]?.offset ?? b.length;
    while (j < ordered.length && ordered[j].offset < person.end + 25) j++;
    const identity = ordered[j];
    if (!identity || identity.offset >= end) continue;
    person.id = identity.id;
    person.uid = identity.uid;
    person.identityOffset = identity.offset;
    // Tagged person relationships: citizenship is kind 08 46 02 ff 00 ff.
    // Other rows reference clubs, people and languages; a country-sized ID
    // alone is not evidence of citizenship.
    const count = b[person.end + 34];
    if (b[person.end + 33] === 1 && person.end + 35 + count * 16 <= identity.offset) {
      for (let k = 0; k < count; k++) {
        const p = person.end + 35 + k * 16;
        const n = b.readUInt32LE(p);
        if (
          n < 256 &&
          n !== person.nation &&
          b.subarray(p + 4, p + 8).every((v) => v === 0) &&
          b[p + 10] === 8 &&
          [9, 70].includes(b[p + 11]) &&
          !person.otherNations.includes(n)
        )
          person.otherNations.push(n);
      }
    }
  }
  return people;
}

export function readAbilities(b: Buffer, start: number) {
  const blocks: AbilityBlock[] = [];
  for (let p = start + 57; p < b.length - 54; p++) {
    if (b[p - 37] || b[p - 35]) continue;
    const ca = b[p - 38],
      pa = b[p - 36];
    if (ca < 1 || ca > 200 || pa < 1 || pa > 200) continue;
    let ok = true,
      natural = false;
    for (let j = -15; j < 0; j++) {
      const v = b[p + j];
      if (v < 1 || v > 20) {
        ok = false;
        break;
      }
      if (v === 20) natural = true;
    }
    if (!ok || !natural) continue;
    for (let j = 0; j < 54; j++) {
      const v = b[p + j];
      if (v < 1 || v > 100) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const uid = b.readUInt32LE(p - 53),
      sourceUid = b.readUInt32LE(p - 49);
    if (!uid || uid === 0xffffffff || !sourceUid || sourceUid === 0xffffffff) continue;
    blocks.push({
      offset: p,
      ownerId: b.readUInt32LE(p - 57) + 1,
      ca,
      pa,
      team: b.readUInt32LE(p - 23),
      positions: Array.from(b.subarray(p - 15, p)),
      raw: Array.from(b.subarray(p, p + 54)),
    });
    p += 53;
  }
  return blocks;
}

export function linkAbilities(people: Person[], blocks: AbilityBlock[]) {
  const linked: { person: Person; ability: AbilityBlock }[] = [];
  let i = 0,
    ambiguous = 0,
    unbound = 0;
  for (const person of people) {
    const first = i;
    while (i < blocks.length && blocks[i].offset < person.offset) i++;
    if (first === i) continue;
    if (i - first !== 1) {
      ambiguous++;
      continue;
    }
    if (person.id < 0 || blocks[first].ownerId !== person.id) {
      unbound++;
      continue;
    }
    linked.push({ person, ability: blocks[first] });
  }
  return { linked, ambiguous, unbound };
}
