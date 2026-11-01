import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const output=await fs.mkdtemp(path.join(os.tmpdir(),'kairo-intelligence-real-'));
await build({entryPoints:['scripts/intelligence-real-model.ts'],outfile:path.join(output,'entry.cjs'),bundle:true,format:'cjs',platform:'node',external:['electron'],plugins:[{name:'native',setup(builder){builder.onResolve({filter:/^better-sqlite3$/},()=>({path:require.resolve('better-sqlite3'),external:true}));}}]});
console.log(`Real model evidence: ${output}`);
const child=spawn(require('electron'),[path.join(output,'entry.cjs')],{cwd:process.cwd(),env:{...process.env,KAIROPILOT_TEST_ROOT:path.join(output,'data'),KAIROPILOT_REAL_MODEL_OUTPUT:output,KAIROPILOT_REAL_MODEL_DELEGATION_ONLY:process.argv.includes('--delegation-only')?'1':''},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',data=>process.stdout.write(data));
// Provider errors may contain request details; only the entry's sanitized report is emitted.
child.stderr.resume();
const timeout=setTimeout(()=>child.kill('SIGKILL'),420000);
const code=await new Promise(resolve=>{child.on('error',()=>resolve(1));child.on('exit',resolve);});clearTimeout(timeout);
const report=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8').catch(()=>'{"success":false,"error":"No final report; inspect the last progress event."}'));
console.log(JSON.stringify(report));
if(code!==0||!report.success)process.exitCode=1;
