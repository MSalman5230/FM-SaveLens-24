import { openSync, readSync, closeSync, fstatSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";

export type Member = { name: string; offset: number; stored: number; plain: number };
export class SaveError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export class Cursor {
  buffer: Buffer;
  pos: number;
  constructor(buffer: Buffer, pos = 0) {
    this.buffer = buffer;
    this.pos = pos;
  }
  need(n: number) {
    if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.buffer.length)
      throw new SaveError("TRUNCATED", "The save contains an incomplete record.");
  }
  u32() {
    this.need(4);
    const n = this.buffer.readUInt32LE(this.pos);
    this.pos += 4;
    return n;
  }
  u64() {
    this.need(8);
    const n = Number(this.buffer.readBigUInt64LE(this.pos));
    this.pos += 8;
    if (!Number.isSafeInteger(n))
      throw new SaveError("INVALID_SIZE", "An archive member is too large.");
    return n;
  }
  text() {
    const n = this.u32();
    if (n > 16384)
      throw new SaveError("INVALID_MANIFEST", "An archive name has an invalid length.");
    this.need(n);
    const s = this.buffer.toString("utf8", this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
}

export class SaveArchive {
  fd: number;
  size: number;
  mtime: number;
  compressed: boolean;
  name: string;
  members: Member[];
  manifestStart: number;
  constructor(path: string) {
    this.fd = openSync(path, "r");
    try {
      const stat = fstatSync(this.fd);
      this.size = stat.size;
      this.mtime = stat.mtimeMs;
      const h = this.read(0, 26);
      if (h.subarray(0, 6).toString("hex") !== "0201666d662e" || h[6] !== 8)
        throw new SaveError(
          "UNSUPPORTED_FORMAT",
          "This file is not a supported FM24 save archive.",
        );
      if (h[25] !== 0 && h[25] !== 3)
        throw new SaveError(
          "UNSUPPORTED_COMPRESSION",
          "This save uses an unsupported compression method.",
        );
      this.compressed = h[25] === 3;
      // FM24: header +9 points nine bytes before the nested manifest header.
      this.manifestStart = Number(h.readBigUInt64LE(9)) + 9;
      const mh = this.read(this.manifestStart, 13);
      if (
        mh.subarray(0, 9).toString("hex") !== "0201666d662e080000" ||
        mh.subarray(9, 13).toString("hex") !== "28b52ffd"
      )
        throw new SaveError(
          "INVALID_MANIFEST",
          "The save index is missing or incomplete. Try a completed backup save.",
        );
      const tailSize = this.size - this.manifestStart - 9;
      if (tailSize > 32 * 1024 * 1024)
        throw new SaveError("INVALID_MANIFEST", "The save index exceeds the supported size.");
      let bytes: Buffer;
      try {
        bytes = zstdDecompressSync(this.read(this.manifestStart + 9, tailSize), {
          maxOutputLength: 64 * 1024 * 1024,
        });
      } catch {
        throw new SaveError("CORRUPT_COMPRESSION", "The save index could not be decompressed.");
      }
      const c = new Cursor(bytes);
      this.name = c.text();
      this.members = [];
      const group = (prefix: string) => {
        const count = c.u32();
        if (count > 100000)
          throw new SaveError("INVALID_MANIFEST", "Invalid number of archive members.");
        for (let i = 0; i < count; i++) {
          let name = "";
          let part = "";
          let parts = 0;
          do {
            part = c.text();
            name += part;
            if (++parts > 20)
              throw new SaveError("INVALID_MANIFEST", "Invalid archive member name.");
          } while (!part.startsWith("."));
          const offset = c.u64(),
            stored = c.u64(),
            plain = c.u64();
          c.need(16);
          c.pos += 16;
          if (
            offset < 0 ||
            stored < 0 ||
            offset + stored + 26 > this.manifestStart ||
            plain > 2 * 1024 ** 3
          )
            throw new SaveError(
              "INVALID_SIZE",
              "A save member has invalid bounds or exceeds 2 GB.",
            );
          this.members.push({ name: prefix + name, offset, stored, plain });
        }
      };
      group("");
      const groups = c.u32();
      if (groups > 10000) throw new SaveError("INVALID_MANIFEST", "Invalid archive groups.");
      for (let i = 0; i < groups; i++) group(c.text() + "/");
      if (!this.members.some((m) => m.name === "game_db.dat"))
        throw new SaveError("MISSING_DATABASE", "The save does not contain a player database.");
    } catch (e) {
      closeSync(this.fd);
      throw e;
    }
  }
  read(position: number, length: number) {
    if (
      !Number.isSafeInteger(position) ||
      !Number.isSafeInteger(length) ||
      position < 0 ||
      length < 0 ||
      position + length > this.size
    )
      throw new SaveError("TRUNCATED", "The save file is incomplete.");
    const b = Buffer.allocUnsafe(length);
    let done = 0;
    while (done < length) {
      const n = readSync(this.fd, b, done, length - done, position + done);
      if (!n) throw new SaveError("TRUNCATED", "The save ended unexpectedly.");
      done += n;
    }
    return b;
  }
  member(name: string) {
    const m = this.members.find((m) => m.name === name);
    if (!m) throw new SaveError("MISSING_MEMBER", `The save is missing ${name}.`);
    const stored = this.read(m.offset + 26, m.stored);
    let b: Buffer;
    try {
      b = this.compressed
        ? zstdDecompressSync(stored, { maxOutputLength: Math.max(m.plain, 1) })
        : stored;
    } catch {
      throw new SaveError("CORRUPT_COMPRESSION", `Could not decompress ${name}.`);
    }
    if (b.length !== m.plain)
      throw new SaveError("INVALID_SIZE", `${name} has an unexpected size.`);
    return b;
  }
  unchanged() {
    const s = fstatSync(this.fd);
    return s.size === this.size && s.mtimeMs === this.mtime;
  }
  close() {
    closeSync(this.fd);
  }
}
