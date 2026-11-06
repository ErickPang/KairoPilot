import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {createDefaultAgentPermissions} from '../../../shared/contracts';
import {PermissionGuard} from '../security/permissions';
import {createPlanningTools} from './planningTools';
import {unwrapToolExecutionResult} from '../tools/result';
const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))fs.rmSync(directory,{recursive:true,force:true});});
function fixture(read=true){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'kairo-planning-')));directories.push(root);
 const guard=new PermissionGuard({...createDefaultAgentPermissions(),executionProfile:'read_only_workspace',fileSystem:{read,write:false,allowedPaths:[root]}});
 return {root,guard};
}
it('exposes only local read/search tools, records successful evidence and preserves file content',async()=>{
 const {root,guard}=fixture();const file=path.join(root,'source.txt');fs.writeFileSync(file,'ATLAS_FACT');const evidence:unknown[]=[];
 const tools=createPlanningTools(root,guard,item=>evidence.push(item));expect(tools.map(item=>item.name).sort()).toEqual(['glob','grep','list_directory','read_file']);
 const result=await tools.find(item=>item.name==='read_file')!.execute({path:file});expect(unwrapToolExecutionResult(result)).toMatchObject({ok:true,data:{content:'ATLAS_FACT'}});expect(evidence).toHaveLength(1);expect(fs.readFileSync(file,'utf8')).toBe('ATLAS_FACT');
});
it('rejects denied reads, escapes through symlinks and oversized files without recording evidence',async()=>{
 const {root,guard}=fixture();const outside=fixture();const secret=path.join(outside.root,'private.txt');fs.writeFileSync(secret,'PRIVATE');const link=path.join(root,'link');fs.symlinkSync(secret,link);
 const large=path.join(root,'large');fs.writeFileSync(large,'x'.repeat(256*1024+1));const evidence:unknown[]=[];const read=createPlanningTools(root,guard,item=>evidence.push(item)).find(item=>item.name==='read_file')!;
 for(const target of [secret,link,large])expect(unwrapToolExecutionResult(await read.execute({path:target})).ok).toBe(false);
 const denied=createPlanningTools(root,fixture(false).guard).find(item=>item.name==='read_file')!;expect(unwrapToolExecutionResult(await denied.execute({path:large})).ok).toBe(false);expect(evidence).toEqual([]);
});
