import {readdirSync,mkdirSync,writeFileSync}from'node:fs';import{join}from'node:path';import{spawn}from'node:child_process';
const folder=String.raw`C:\Users\LX\Documents\Sports Interactive\Football Manager 2024\games`;const files=readdirSync(folder).filter(x=>x.endsWith('.fm'));const results=[];mkdirSync('.cache',{recursive:true});
const concurrency=process.argv.includes('--parallel')?3:1;
for(let i=0;i<files.length;i+=concurrency){
 const batch=await Promise.all(files.slice(i,i+concurrency).map(async(file,index)=>{
 const result=await new Promise<any>(resolve=>{const child=spawn(process.execPath,['research/check-one.ts',join(folder,file)],{windowsHide:true});let output='',err='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>err+=x);child.on('error',e=>resolve({file,error:e.message}));child.on('exit',code=>{try{resolve(code?{file,error:err.trim()}:{file,...JSON.parse(output)})}catch{resolve({file,error:output+' '+err})}})});
 console.log(`${i+index+1}/${files.length} ${file}: ${result.error?'ERROR '+result.error.split('\n')[0]:result.players+' players; '+result.elapsedMs+' ms; unchanged='+result.unchanged}`);return result;
 }));results.push(...batch);writeFileSync('.cache/collection-report.json',JSON.stringify(results,null,2));
}
