import {createHash} from 'node:crypto';
import {createReadStream,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const version=JSON.parse(readFileSync('package.json','utf8')).version;
const prefix=`FM-SaveLens-24-v${version}`;
const expected=[`${prefix}-windows-x64-portable.zip`,`${prefix}-windows-x64-setup.exe`,`${prefix}-linux-x86_64.AppImage`,`${prefix}-linux-x86_64.flatpak`].sort();
assert.deepEqual(readdirSync('dist').filter(n=>n!=='SHA256SUMS.txt').sort(),expected);
const lines=[];for(const name of expected){const hash=createHash('sha256');for await(const chunk of createReadStream(`dist/${name}`))hash.update(chunk);lines.push(`${hash.digest('hex')}  ${name}`);}
writeFileSync('dist/SHA256SUMS.txt',lines.join('\n')+'\n');console.log('All four release packages verified.');
