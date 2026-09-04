import { SaveArchive } from '../server/parser/archive.ts';
const a = new SaveArchive(process.argv[2] || String.raw`C:\Users\LX\Documents\Sports Interactive\Football Manager 2024\games\Salford - Masood.fm`);
const b = a.member('game_db.dat'); a.close();
const startTime = Date.now();
const sections = [];
for (let p = 0; p < b.length - 12;) {
  let q = p, count = 0, first = [], last = [], prevId = -1, resets = [];
  while (q + 8 < b.length) {
    const n = b.readUInt32LE(q + 4); if (n < 1 || n > 150) break;
    const id = b.readUInt32LE(q); if (id > 10000000 || q + 8 + n > b.length) break;
    const s = b.toString('utf8', q + 8, q + 8 + n); if (/[\u0000-\u001f\ufffd]/.test(s)) break;
    if (count < 3) first.push([id, s]); if (id < prevId) resets.push({q,count,prevId,id,s}); prevId=id;
    last.push([id,s]);if(last.length>3)last.shift();
    q += 8 + n; count++;
  }
  if (count > 100) { sections.push({start:p,end:q,count,first,last,resets:resets.slice(0,15)}); p = q; } else p++;
}
console.log(JSON.stringify({ms:Date.now()-startTime,sections},null,2));
