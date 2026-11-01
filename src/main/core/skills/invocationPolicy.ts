import fs from 'node:fs/promises';
import path from 'node:path';
/** Read only the supported OpenAI policy boolean; never execute YAML tags or expand references. */
export async function readImplicitInvocationPolicy(skillDir:string):Promise<{allowed:boolean;raw:string}> {
 const file=path.join(skillDir,'agents','openai.yaml');let raw:string;
 try {
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw new Error('Unsafe skill policy file.');
  if(await fs.realpath(file)!==file)throw new Error('Redirected skill policy file.');
  raw=await fs.readFile(file,'utf8');
 }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {allowed:true,raw:''};throw error;}
 let policy=false,allowed=true,seen=false,hasInvocation=false;
 for(const line of raw.split(/\r?\n/)){
  if(/^policy\s*:/.test(line)){if(seen)throw new Error('Duplicate skill policy.');seen=true;policy=true;if(!/^policy\s*:\s*(?:#.*)?$/.test(line))throw new Error('Use a block policy with allow_implicit_invocation boolean.');continue;}
  if(/^\S/.test(line)&&!line.startsWith('#'))policy=false;
  if(policy&&/^\s+allow_implicit_invocation\s*:/.test(line)){
   if(hasInvocation)throw new Error('Duplicate skill invocation policy.');hasInvocation=true;
   const match=line.match(/^\s+allow_implicit_invocation\s*:\s*(true|false)\s*(?:#.*)?$/);if(!match)throw new Error('Skill allow_implicit_invocation must be a boolean.');allowed=match[1]==='true';
  }
 }
 return {allowed,raw};
}
