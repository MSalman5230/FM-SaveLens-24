import{SaveArchive}from'../server/parser/archive.ts';import{readNames}from'../server/parser/strings.ts';import{readAbilities,readPeople}from'../server/parser/people.ts';
const a=new SaveArchive(process.argv[2]),b=a.member('game_db.dat');a.close();const n=readNames(b),blocks=readAbilities(b,n.end);
console.log(readPeople(b,n).filter(p=>p.id>=88912&&p.id<=88918).map(p=>({id:p.id,offset:p.offset,end:p.end,name:p.name,identity:p.identityOffset})));
for(let i=0;i<blocks.length;i++){const a=blocks[i];if(![88914,88916,88989,89058].includes(a.ownerId))continue;const candidates=[];
 for(let p=a.offset+54;p<(blocks[i+1]?.offset??b.length)-40;p++){const f=b.readUInt32LE(p),l=b.readUInt32LE(p+5),len=b.readUInt32LE(p+15);if(len>200)continue;const e=p+19+len,day=b.readUInt16LE(e),year=b.readUInt16LE(e+2),nation=b.readUInt16LE(e+9);if(year<1900||year>2050||day<1||day>366||nation>255||!b.subarray(e+11,e+17).every(x=>x===0))continue;
 candidates.push({offset:p,f,l,markers:[b[p+4],b[p+9],b[p+14]],name:n.first[f]+' '+n.last[l],day,year,nation,zeros:b.subarray(e+11,e+17).toString('hex'),personality:Array.from(b.subarray(e+17,e+25)),full:b.toString('utf8',p+19,e)});
 }
 console.log(JSON.stringify({id:a.ownerId,offset:a.offset,next:blocks[i+1]?.offset,candidates}));
}
