import { SaveArchive } from '../server/parser/archive.ts';
import { readNames } from '../server/parser/strings.ts';
const a = new SaveArchive(process.argv[2] || String.raw`C:\Users\LX\Documents\Sports Interactive\Football Manager 2024\games\Salford - Masood.fm`);
const b = a.member('game_db.dat'); a.close(); const names=readNames(b);
console.log('names',names.first.length,names.last.length,names.common.length,names.start,names.end);
const people=[];
for(let p=names.end;p<b.length-100;p++){
 if(b[p+4]||b[p+9]||b[p+14]||b[p+17]||b[p+18])continue;
 const f=b.readUInt32LE(p),l=b.readUInt32LE(p+5),c=b.readUInt32LE(p+10),n=b.readUInt32LE(p+15);
 if(f>=names.first.length||l>=names.last.length||(c!==0xffffffff&&c>=names.common.length)||n>200)continue;
 const e=p+19+n,day=b.readUInt16LE(e),year=b.readUInt16LE(e+2);if(day<1||day>366||year<1850||year>2200)continue;
 const nation=b.readUInt16LE(e+9);if(nation<1||nation>255||!b.subarray(e+11,e+17).every(v=>v===0)||!b.subarray(e+17,e+25).every(v=>v>=1&&v<=20))continue;
 const full=b.toString('utf8',p+19,e);if(/[\u0000-\u001f\ufffd]/.test(full))continue;
 people.push({p,e,name:names.common[c]||`${names.first[f]} ${names.last[l]}`,full,day,year,nation,hidden:Array.from(b.subarray(e+17,e+25))});
}
const blocks=[];
for(let p=names.end+38;p<b.length-54;p++){
 if(b[p-37]||b[p-35])continue;
 const ca=b[p-38],pa=b[p-36];if(!ca||ca>200||!pa||pa>200)continue;
 let ok=true;for(let j=-15;j<0;j++){if(b[p+j]<1||b[p+j]>20){ok=false;break}}if(!ok)continue;
 if(!b.subarray(p-15,p).includes(20))continue;
 for(let j=0;j<54;j++){if(b[p+j]<1||b[p+j]>100){ok=false;break}}if(!ok)continue;
 blocks.push({p,ca,pa});p+=53;
}
console.log({people:people.length,blocks:blocks.length});
let ix=0;const assigned=[];
for(const person of people){const before=ix;while(ix<blocks.length&&blocks[ix].p<person.p)ix++;const block=blocks[ix-1];if(!block||before===ix)continue;assigned.push({...person,block,gap:person.p-block.p})}
const refs=/Saleh.*Ert|Abu.*Suleiman|Tom.*Karlsson|Aaron.*Nattermann|Carlos.*Cabral|Imran.*Ali|Leigh.*Roberts|Luís.*Concei|Álex.*Méndez|Rohat.*Aktarla|Franko.*Ćaleta|Luca.*Paolini|Matheus.*Vigh|Mustapha.*Cesay|Mohammed.*Dauda|^Enol$|Alexandru.*Filip|Ralf.*Lieberknecht/;
console.log(JSON.stringify(assigned.filter(p=>refs.test(p.name)),null,2));
console.log('enol',assigned.filter(p=>p.name.startsWith('Enol')));
let multi=0,missing=0;const candidates=[];for(let i=0;i<people.length;i++){const person=people[i],end=people[i+1]?.p??b.length;const matches=[];for(let p=person.e+25;p<Math.min(end,person.e+20000)-12;p++){if(b[p-1]||b[p-2]||b[p-3]||(b[p-7]&15)>2)continue;const eid=b.readUInt32LE(p),uid=b.readUInt32LE(p+4);if(!eid||eid>1000000||!uid||uid!==b.readUInt32LE(p+8))continue;matches.push({p,eid,uid,head:b.subarray(p-7,p).toString('hex')});}if(!matches.length)missing++;if(matches.length>1)multi++;if(refs.test(person.name))candidates.push({name:person.name,matches:matches.slice(0,5)});};console.log('identity',JSON.stringify({multi,missing,candidates},null,2));
const gaps=assigned.map(p=>p.gap).sort((a,b)=>a-b);console.log('gaps',[0,.1,.5,.9,.95,.99,1].map(v=>[v,gaps[Math.min(gaps.length-1,Math.floor(v*gaps.length))]]));
