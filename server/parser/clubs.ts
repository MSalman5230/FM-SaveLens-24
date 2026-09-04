export type Club = {
  id: number;
  uid: number;
  name: string;
  shortName: string;
  nation: number;
  offset: number;
};
export function readClubs(b: Buffer, end: number): Club[] {
  const clubs: Club[] = [];
  for (let p = 0; p + 50 < end; p++) {
    if (
      b[p + 12] ||
      b[p + 17] !== 255 ||
      b[p + 18] !== 255 ||
      b[p + 19] !== 255 ||
      b[p + 20] !== 255
    )
      continue;
    const nation = b.readUInt32LE(p + 13);
    if (nation > 255 || b.readUInt32LE(p + 25) !== nation) continue;
    const uid = b.readUInt32LE(p + 4),
      id = b.readUInt32LE(p);
    if (!uid || uid === 0xffffffff || uid !== b.readUInt32LE(p + 8) || id > 100000) continue;
    const n = b.readUInt32LE(p + 39);
    if (n < 2 || n > 200 || p + 47 + n >= end) continue;
    const sn = b.readUInt32LE(p + 43 + n);
    if (sn < 1 || sn > 100 || p + 47 + n + sn > end) continue;
    const name = b.toString("utf8", p + 43, p + 43 + n),
      shortName = b.toString("utf8", p + 47 + n, p + 47 + n + sn);
    if (/[\u0000-\u001f\ufffd]/.test(name + shortName)) continue;
    clubs.push({ id, uid, nation, name, shortName, offset: p });
    p += 46 + n + sn;
  }
  return clubs;
}
