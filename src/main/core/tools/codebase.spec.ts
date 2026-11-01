import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {createCodebaseTools} from './codebase';
import {PermissionGuard} from '../security/permissions';
import {createDefaultAgentPermissions} from '../../../shared/contracts';
import type {ToolSuccessResult} from './result';

let root:string;
beforeEach(async()=>{root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'kairo-grep-')));});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
function grep(){const permissions=createDefaultAgentPermissions();permissions.executionProfile='read_only_workspace';permissions.fileSystem={read:true,write:false,allowedPaths:[root]};return createCodebaseTools(root,new PermissionGuard(permissions))[0];}
async function matches(args:Record<string,unknown>){const result=await grep().execute(args) as ToolSuccessResult<{matches:string[]}>;expect(result.ok).toBe(true);return result.data.matches;}
describe('permission-checked native grep',()=>{
 it('returns every consecutive matching line, counts and matching files',async()=>{
  const file=path.join(root,'source.ts');await fs.writeFile(file,'import first\nimport second\nimport third\nother\nimport fourth');
  const found=await matches({pattern:'^import',output_mode:'content'});expect(found).toEqual([1,2,3,5].map(line=>`${file}:${line}: import ${['first','second','third','','fourth'][line-1]}`));
  expect(await matches({pattern:'^import',output_mode:'count'})).toEqual([`${file}: 4`]);
  expect(await matches({pattern:'^import',output_mode:'files_with_matches'})).toEqual([file]);
  expect(await matches({pattern:'^import',output_mode:'content',head_limit:2})).toHaveLength(2);
 });
 it('searches a single file and respects glob and type filters',async()=>{
  const file=path.join(root,'source.ts');await fs.writeFile(file,'import first\nimport second');
  expect(await matches({path:file,pattern:'^import',output_mode:'content',glob:'*.ts',type:'ts'})).toHaveLength(2);
  expect(await matches({path:file,pattern:'^import',glob:'*.js'})).toEqual([]);
  expect(await matches({path:file,pattern:'^import',type:'js'})).toEqual([]);
 });
 it('applies case-insensitive matching without carrying state between lines',async()=>{
  const file=path.join(root,'case.txt');await fs.writeFile(file,'IMPORT first\nImport second\nimport third');
  expect(await matches({path:file,pattern:'^import','-i':true,output_mode:'count'})).toEqual([`${file}: 3`]);
  expect(await matches({path:file,pattern:'^import',output_mode:'count'})).toEqual([`${file}: 1`]);
 });
 it('does not search denied files or symlinks outside the permitted root',async()=>{
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'kairo-grep-denied-'));
  try{const file=path.join(outside,'private.ts');await fs.writeFile(file,'import private');const link=path.join(root,'link.ts');await fs.symlink(file,link);expect(await matches({path:file,pattern:'import'})).toEqual([]);expect(await matches({path:link,pattern:'import'})).toEqual([]);expect(await matches({pattern:'import'})).toEqual([]);}finally{await fs.rm(outside,{recursive:true,force:true});}
 });
});
