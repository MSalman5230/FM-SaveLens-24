import { SaveError } from "./archive.ts";
export type Names = {
  first: string[];
  last: string[];
  common: string[];
  start: number;
  end: number;
};

function readPool(b: Buffer, start: number) {
  if (start + 16 >= b.length) return null;
  const count = b.readUInt32LE(start);
  if (count < 1 || count > 3000000) return null;
  const names: string[] = [];
  let p = start + 4;
  for (let id = 0; id < count; id++) {
    if (p + 8 > b.length || b.readUInt32LE(p) !== id) return null;
    const n = b.readUInt32LE(p + 4);
    if (n > 512 || p + 8 + n > b.length) return null;
    const s = b.toString("utf8", p + 8, p + 8 + n);
    if (/[\u0000-\u001f\ufffd]/.test(s)) return null;
    names.push(s);
    p += 8 + n;
  }
  return { names, end: p };
}

export function readNames(b: Buffer): Names {
  // Each pool carries a count and contiguous IDs starting at zero. Empty
  // strings are valid, including the user-created-name entry in long careers.
  for (let p = 0; p + 40 < b.length; p++) {
    if (b[p + 7] !== 0 || b[p + 6] !== 0 || b[p + 5] !== 0 || b[p + 4] !== 0) continue;
    const count = b.readUInt32LE(p);
    if (count < 10000 || count > 3000000) continue;
    const n = b.readUInt32LE(p + 8);
    if (n < 1 || n > 100 || p + 16 + n > b.length || b.readUInt32LE(p + 12 + n) !== 1) continue;
    const first = readPool(b, p);
    if (!first) continue;
    const last = readPool(b, first.end);
    if (!last || last.names.length < 10000) continue;
    const common = readPool(b, last.end);
    if (!common) continue;
    return {
      first: first.names,
      last: last.names,
      common: common.names,
      start: p,
      end: common.end,
    };
  }
  throw new SaveError("UNSUPPORTED_NAMES", "Could not locate the FM24 name tables in this save.");
}
