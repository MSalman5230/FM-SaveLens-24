import {SaveArchive}from'../server/parser/archive.ts';import{readNames}from'../server/parser/strings.ts';import{readPeople,readAbilities}from'../server/parser/people.ts';
const a=new SaveArchive(process.argv[2]);const b=a.member('game_db.dat');a.close();const n=readNames(b),p=readPeople(b,n),blocks=readAbilities(b,n.end);let i=0,count=0;
for(let j=0;j<p.length;j++){const person=p[j],first=i;while(i<blocks.length&&blocks[i].offset<person.offset)i++;if(first===i)continue;const ab=blocks[first];if(person.id===ab.ownerId)continue;
 const candidates=[];for(let k=person.end+25;k<(p[j+1]?.offset??b.length)-12;k++)if(b.readUInt32LE(k)===ab.ownerId)candidates.push({offset:k,uid:b.readUInt32LE(k+4),uid2:b.readUInt32LE(k+8),before:b.subarray(k-12,k).toString('hex'),after:b.subarray(k,k+32).toString('hex')});
 console.log(JSON.stringify({name:person.name,id:person.id,expected:ab.ownerId,offset:person.offset,end:person.end,identity:person.identityOffset,candidates}));if(++count===20)break;
}
