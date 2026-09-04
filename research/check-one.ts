import {parseSave,PARSER_VERSION} from '../server/parser/index.ts';
import {createHash} from 'node:crypto';
import {createReadStream,statSync,openSync,readSync,closeSync} from 'node:fs';
async function hash(path:string){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
const path=process.argv[2];const before=await hash(path);let result:Record<string,unknown>;
const fd=openSync(path,'r'),header=Buffer.alloc(26);readSync(fd,header,0,26,0);closeSync(fd);
try{const s=parseSave(path);result={name:s.name,gameDate:s.gameDate,...s.diagnostics,warnings:s.warnings};}catch(e){result={error:(e as Error).message};}
const after=await hash(path);
console.log(JSON.stringify({...result,parserVersion:PARSER_VERSION,size:statSync(path).size,compressed:header[25]===3,unchanged:before===after,sha256:after}));
