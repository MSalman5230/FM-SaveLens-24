import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const [binary,...args]=process.argv.slice(2);
if(!binary)throw new Error('Pass a server executable, AppImage --browser, or flatpak run command');
const root=process.env.FMSAVELENS_SMOKE_ROOT || tmpdir();mkdirSync(root,{recursive:true});
const data=mkdtempSync(join(root,'fm-savelens-smoke-'));
const child=spawn(binary,[...args,'--port','0','--no-open'],{windowsHide:true,detached:process.platform!=='win32',env:{...process.env,FM_SAVELENS_24_DATA_DIR:data},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
let spawnError;child.on('error',e=>spawnError=e);
try{
  let port;
  for(let i=0;i<600;i++){
    if(spawnError)throw spawnError;
    port=output.match(/"port":(\d+)/)?.[1];if(port)break;
    if(child.exitCode!==null)throw new Error(output || `Process exited ${child.exitCode}`);
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(port,output || 'Server startup timed out');
  const base=`http://127.0.0.1:${port}`;
  const health=await (await fetch(`${base}/api/health`)).json();assert.equal(health.app,'fm24-scout');assert.equal(health.productName,'FM SaveLens 24');
  const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/SAVELENS/i);
  const settings=await (await fetch(`${base}/api/settings`)).json();assert.equal(typeof settings.folder,'string');
  if(process.env.FMSAVELENS_SMOKE_SAVE_DIR){
    const response=await fetch(`${base}/api/settings`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:process.env.FMSAVELENS_SMOKE_SAVE_DIR})});
    assert.equal(response.status,200,await response.text());
    const saves=await (await fetch(`${base}/api/saves`)).json();
    const save=saves.saves.find(s=>s.name==='career.fm');assert.ok(save,'Synthetic save must be visible inside the package sandbox');
    let job=await (await fetch(`${base}/api/imports`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({saveId:save.id})})).json();
    for(let i=0;i<300 && job.status==='running';i++){
      await new Promise(r=>setTimeout(r,100));
      job=await (await fetch(`${base}/api/imports/${job.id}`)).json();
    }
    assert.equal(job.status,'complete',JSON.stringify(job));
    const result=await (await fetch(`${base}/api/snapshots/${job.snapshotId}/players?q=alvaro`)).json();
    assert.equal(result.total,64);
    console.log('Packaged synthetic save import and Unicode search passed.');
  }
  console.log(`Packaged application ${health.version}: assets, health and settings passed.`);
}finally{
  if(child.pid){
    // AppImage extraction wrappers and Flatpak can own child processes. Stop the
    // test's entire POSIX process group and wait for inherited pipes to close.
    const closed=once(child,'close');
    try {if(process.platform==='win32')child.kill();else process.kill(-child.pid,'SIGTERM');}
    catch(error){if(error.code!=='ESRCH')throw error;}
    let timer;
    await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>{
      if(process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL');}catch{}}
      reject(new Error('Packaged process did not shut down within 15 seconds'));
    },15000);})]).finally(()=>clearTimeout(timer));
  }
  assert.ok(resolve(data).startsWith(resolve(root)+ (process.platform==='win32'?'\\':'/')));
  rmSync(data,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
