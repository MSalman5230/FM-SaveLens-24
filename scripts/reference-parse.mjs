import { parseSave } from '../server/parser/index.ts';
try { process.stdout.write(JSON.stringify(parseSave(process.argv[2]))); }
catch (e) { process.stdout.write(JSON.stringify({ error: e.message, code: e.code })); }
