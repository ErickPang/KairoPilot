import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const root=process.cwd();
const output=await fs.mkdtemp(path.join(os.tmpdir(),'kairo-unified-'));
const nativePlugin={name:'native-sqlite',setup(builder){builder.onResolve({filter:/^better-sqlite3$/},()=>({path:require.resolve('better-sqlite3'),external:true}));}};
await build({entryPoints:['scripts/unified-workbench-entry.ts'],outfile:path.join(output,'entry.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron'],plugins:[nativePlugin]});
await build({entryPoints:['src/preload/index.ts'],outfile:path.join(output,'preload.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron']});
await build({entryPoints:['src/renderer/main.tsx'],outfile:path.join(output,'renderer.js'),bundle:true,platform:'browser',format:'iife',define:{'import.meta.env.DEV':'false','process.env.NODE_ENV':'"development"'},loader:{'.png':'dataurl','.svg':'dataurl'}});
await fs.copyFile('public/icon.png',path.join(output,'icon.png'));
await fs.writeFile(path.join(output,'index.html'),'<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>');
console.log(`Unified workbench evidence: ${output}`);
for (const phase of ['1','2','3']) {
 const child=spawn(require('electron'),[path.join(output,'entry.cjs')],{cwd:root,env:{...process.env,KAIROPILOT_TEST_ROOT:path.join(output,'data'),KAIROPILOT_UNIFIED_OUTPUT:output,KAIROPILOT_UNIFIED_PHASE:phase},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stdout.resume();child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-30000);});
 let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},90000);
 let signal=null;const code=await new Promise(resolve=>{child.on('error',()=>resolve(1));child.on('exit',(code,reason)=>{signal=reason;resolve(code);});});clearTimeout(timeout);
 await fs.writeFile(path.join(output,`stderr-${phase}.log`),stderr);
 const report=JSON.parse(await fs.readFile(path.join(output,`report-${phase}.json`),'utf8').catch(()=>'{"success":false,"error":"Electron exited without report"}'));
 console.log(JSON.stringify({phase,code,signal,timedOut,...report}));
 if(code!==0||!report.success){process.exitCode=1;break;}
}
