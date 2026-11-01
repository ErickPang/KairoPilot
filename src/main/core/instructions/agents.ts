import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export interface InstructionSource {path:string;hash:string;content:string;scope:'global'|'project'}
export const INSTRUCTION_MAX_BYTES=32768;
export const instructionHash=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Select one nonempty file per directory. Never recursively scan the repository. */
export function readAgentsDirectory(directory:string,scope:InstructionSource['scope']):InstructionSource|undefined{
 for(const name of ['AGENTS.override.md','AGENTS.md']){
  const file=path.join(directory,name);
  if(!fs.existsSync(file))continue;
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error(`Instruction file must be a regular file: ${file}`);
  if(stat.size>INSTRUCTION_MAX_BYTES)throw new Error(`Instruction file exceeds 32 KiB: ${file}`);
  const content=fs.readFileSync(file,'utf8');if(!content.trim())continue;
  return {path:file,hash:instructionHash(content),content,scope};
 }
}
export function discoverInstructions(globalRoot:string,executionRoot?:string){
 const sources:InstructionSource[]=[];const global=readAgentsDirectory(globalRoot,'global');if(global)sources.push(global);
 if(executionRoot){
  const cwd=fs.realpathSync(executionRoot);let projectRoot=cwd;let cursor=cwd;
  while(cursor){if(fs.existsSync(path.join(cursor,'.git'))){projectRoot=cursor;break;}const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  const relative=path.relative(projectRoot,cwd);const dirs=[projectRoot];let directory=projectRoot;
  for(const segment of relative.split(path.sep).filter(Boolean)){directory=path.join(directory,segment);dirs.push(directory);}
  for(const dir of dirs){const source=readAgentsDirectory(dir,'project');if(source&&!sources.some(item=>item.path===source.path))sources.push(source);}
 }
 if(sources.reduce((sum,item)=>sum+Buffer.byteLength(item.content,'utf8'),0)>INSTRUCTION_MAX_BYTES)throw new Error('Combined AGENTS.md instructions exceed 32 KiB. Split or shorten the applicable instructions.');
 return sources;
}
export function renderInstructions(sources:InstructionSource[]){return sources.map(source=>`<instruction_file scope="${source.scope}" path=${JSON.stringify(source.path)} hash="${source.hash}">\n${source.content}\n</instruction_file>`).join('\n\n');}
export function writeAgentsFile(root:string,content:string,name:'AGENTS.md'|'AGENTS.override.md'='AGENTS.md'){
 if(Buffer.byteLength(content,'utf8')>INSTRUCTION_MAX_BYTES)throw new Error('AGENTS.md exceeds 32 KiB.');
 fs.mkdirSync(root,{recursive:true});const file=path.join(root,name);
 if(fs.existsSync(file)&&!fs.lstatSync(file).isFile())throw new Error('AGENTS.md must be a regular file.');
 const temporary=`${file}.${process.pid}.tmp`;fs.writeFileSync(temporary,content,{mode:0o600});fs.renameSync(temporary,file);
}
