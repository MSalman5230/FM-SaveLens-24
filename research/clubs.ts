import { SaveArchive } from '../server/parser/archive.ts';
const a=new SaveArchive(process.argv[2]||String.raw`C:\Users\LX\Documents\Sports Interactive\Football Manager 2024\games\Salford - Masood.fm`),b=a.member('game_db.dat');
for(const s of ['Salford City','Salford','Manchester City','Tottenham Hotspur','Brentford']) {
 let p=-1;let count=0;while((p=b.indexOf(Buffer.from(s),p+1))>=0){if(++count>8)break;console.log(s,'at',p,'before',b.subarray(p-50,p).toString('hex'),'after',b.subarray(p+s.length,p+s.length+50).toString('hex'))}
}
for(const m of ['game_info.dat','save_game_summary.dat']){const d=a.member(m);console.log(m,d.length,d.subarray(0,400).toString('hex'),d.subarray(0,400).toString('latin1').replace(/[^ -~]/g,'.'))}
a.close();
