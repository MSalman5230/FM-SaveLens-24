import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const stage='packaging/stage/flatpak-source';mkdirSync(stage,{recursive:true});
for(const file of ['Cargo.toml','Cargo.lock','native','server/parser/nations.json','src-tauri/Cargo.toml','src-tauri/build.rs','src-tauri/src','src-tauri/icons','src-tauri/tauri.conf.json','src-tauri/tauri.linux.conf.json','web/dist/client']) {
  cpSync(file,`${stage}/${file}`,{recursive:true});
}
mkdirSync(`${stage}/.cargo`,{recursive:true});
writeFileSync(`${stage}/.cargo/config.toml`,'[source.crates-io]\nreplace-with = "vendored-sources"\n[source.vendored-sources]\ndirectory = "vendor"\n');
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const date=execFileSync('git',['log','-1','--format=%cs'],{encoding:'utf8'}).trim();
writeFileSync(`${stage}/fm-savelens.metainfo.xml`,readFileSync('packaging/fm-savelens.metainfo.xml','utf8').replaceAll('@VERSION@',version).replaceAll('@DATE@',date));
cpSync('packaging/fm-savelens.desktop',`${stage}/fm-savelens.desktop`);
