import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);

export async function verifyBootstrapLifecycle(output) {
  await build({entryPoints:['scripts/bootstrap-native.ts'],outfile:path.join(output,'bootstrap.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron'],plugins:[{name:'native-sqlite',setup(b){b.onResolve({filter:/^better-sqlite3$/},()=>({path:require.resolve('better-sqlite3'),external:true}));}}]});
  await fs.copyFile(path.join(output,'preload.cjs'),path.join(output,'index.mjs'));
  const spawnMode=(mode,data)=>{
    const child=spawn(require('electron'),[path.join(output,'bootstrap.cjs')],{cwd:process.cwd(),env:{...process.env,KAIROPILOT_TEST_ROOT:path.join(output,data),KAIROPILOT_BOOTSTRAP_OUTPUT:output,KAIROPILOT_BOOTSTRAP_MODE:mode},stdio:['ignore','pipe','pipe']});
    let stderr='';child.stdout.resume();child.stderr.on('data',part=>{stderr=(stderr+part).slice(-15000);});
    const timeout=setTimeout(()=>child.kill('SIGKILL'),30000);
    const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',async code=>{
      clearTimeout(timeout);await fs.writeFile(path.join(output,`bootstrap-${mode}.log`),stderr);
      if(code===0)resolve();else reject(new Error(`Bootstrap ${mode} process failed (${code}). Evidence: ${output}`));
    });});
    // Attach a rejection handler while another process is being coordinated.
    void done.catch(()=>{});return {child,done};
  };
  for(const mode of ['failure','cancel'])await spawnMode(mode,`bootstrap-${mode}-data`).done;
  const primary=spawnMode('primary','bootstrap-shared-data');
  try {
    const deadline=Date.now()+20000;
    while(!await fs.access(path.join(output,'bootstrap-primary-ready.json')).then(()=>true,()=>false)) {
      if(Date.now()>deadline)throw new Error('Primary bootstrap did not become ready.');
      await Promise.race([new Promise(resolve=>setTimeout(resolve,25)),primary.done.then(()=>{throw new Error('Primary exited before secondary-instance acceptance.');})]);
    }
    await spawnMode('secondary','bootstrap-shared-data').done;
    await fs.writeFile(path.join(output,'bootstrap-secondary-finished'),'ready');await primary.done;
  } catch(error) {primary.child.kill('SIGKILL');await primary.done.catch(()=>{});throw error;}
  for(const mode of ['failure','cancel','primary','secondary']) {
    const report=JSON.parse(await fs.readFile(path.join(output,`bootstrap-${mode}.json`),'utf8'));
    if(!report.success)throw new Error(`Bootstrap ${mode}: ${report.error}`);
    console.log(JSON.stringify({bootstrap:mode,...report}));
  }
}
