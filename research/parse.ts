import {parseSave} from '../server/parser/index.ts';
const s=parseSave(process.argv[2]||String.raw`C:\Users\LX\Documents\Sports Interactive\Football Manager 2024\games\Salford - Masood.fm`,(p,m)=>console.error(p,m));
console.log({name:s.name,date:s.gameDate,diagnostics:s.diagnostics,warnings:s.warnings});
console.log(JSON.stringify(s.players.sort((a,b)=>b.pa-a.pa||b.ca-a.ca).slice(0,20).map(p=>({id:p.id,uid:p.uid,name:p.name,ca:p.ca,pa:p.pa,age:p.age,club:p.club,nation:p.nationId,other:p.otherNationIds,pos:p.positions,ad:p.attributes.adaptability,acc:p.attributes.acceleration})),null,2));
