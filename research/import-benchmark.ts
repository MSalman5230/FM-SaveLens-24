import {writeFileSync}from'node:fs';
const base='http://127.0.0.1:4242/api';async function api(path:string,body?:unknown){const r=await fetch(base+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const v=await r.json() as any;if(!r.ok)throw new Error(v.error);return v;}
const files=(await api('/saves')).saves;const file=files.sort((a:any,b:any)=>b.size-a.size)[0];const start=performance.now();let job=await api('/imports',{saveId:file.id});let maxHealthMs=0,maxSearchMs=0;const last=(await api('/settings')).lastSnapshot;
while(job.status==='running'){
 let t=performance.now();await api('/health');maxHealthMs=Math.max(maxHealthMs,performance.now()-t);
 if(last){t=performance.now();await api('/snapshots/'+last+'/players?paMin=150&ageMax=25&attr_pace=15&limit=50');maxSearchMs=Math.max(maxSearchMs,performance.now()-t);}
 await new Promise(r=>setTimeout(r,100));job=await api('/imports/'+job.id);
}
const result={file:file.name,size:file.size,wallMs:Math.round(performance.now()-start),maxHealthMs,maxSearchMs,job};writeFileSync('.cache/import-benchmark.json',JSON.stringify(result,null,2));console.log(result);if(job.status!=='complete')process.exitCode=1;
