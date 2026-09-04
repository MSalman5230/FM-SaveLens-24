import { SaveArchive } from '../server/parser/archive.ts';
import { readNames } from '../server/parser/strings.ts';
import { readClubs } from '../server/parser/clubs.ts';
const a=new SaveArchive(process.argv[2]||String.raw`C:\Users\LX\Documents\Sports Interactive\Football Manager 2024\games\Salford - Masood.fm`),b=a.member('game_db.dat');a.close();const names=readNames(b),clubs=readClubs(b,names.start);
console.log('clubs',clubs.length,clubs.filter(c=>/Salford|Manchester City|Tottenham Hotspur|Brentford/.test(c.name)));
const salford=clubs.find(c=>c.shortName==='Salford')!;
for(const id of [salford.id,salford.id+1]){
 let at=-1,count=0;const needle=Buffer.alloc(14);needle.writeUInt32LE(id);
 while((at=b.indexOf(needle,at+1))>=0){if(at>names.start)continue;if(++count>25)break;console.log('head',id,at,Array.from(b.subarray(at-4,at+100)).join(','));}
}
for(const id of [374614,374615,374616,374617]){let at=-1,count=0;const needle=Buffer.alloc(4);needle.writeUInt32LE(id);const hits=[];while((at=b.indexOf(needle,at+1))>=0){if(at>names.start)continue;if(++count>20)break;hits.push({at,before:b.subarray(at-16,at).toString('hex'),after:b.subarray(at,at+24).toString('hex')})}console.log('player',id,hits)}
