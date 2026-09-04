import { SaveArchive } from '../server/parser/archive.ts';
const file = process.argv[2] || String.raw`C:\Users\LX\Documents\Sports Interactive\Football Manager 2024\games\Salford - Masood.fm`;
const archive = new SaveArchive(file);
console.log({ name: archive.name, size: archive.size, compressed: archive.compressed, members: archive.members.length });
const b = archive.member('game_db.dat');
console.log('database', b.length, 'header', b.subarray(0, 160).toString('hex'));
if (process.argv[3]) {
  const at = Number(process.argv[3]); const len = Number(process.argv[4] || 200);
  for (let p = at; p < at + len; p += 32) console.log(p, b.subarray(p, p + 32).toString('hex').match(/../g)?.join(' '), b.subarray(p, p + 32).toString('latin1').replace(/[^ -~]/g, '.'));
}
archive.close();
