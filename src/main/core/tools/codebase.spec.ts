import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createCodebaseTools,EditTool} from './codebase';
import {PermissionGuard} from '../security/permissions';
import {createDefaultAgentPermissions} from '../../../shared/contracts';
import type {ToolSuccessResult} from './result';

let root:string;
beforeEach(async()=>{root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'kairo-grep-')));});
afterEach(async()=>{await fs.rm(root,{recursive:true,force:true});});
function grep(){const permissions=createDefaultAgentPermissions();permissions.executionProfile='read_only_workspace';permissions.fileSystem={read:true,write:false,allowedPaths:[root]};return createCodebaseTools(root,new PermissionGuard(permissions))[0];}
async function matches(args:Record<string,unknown>){const result=await grep().execute(args) as ToolSuccessResult<{matches:string[]}>;expect(result.ok).toBe(true);return result.data.matches;}
describe('permission-checked native grep',()=>{
 it('supports brace, recursive and basename glob filters',async()=>{
  await fs.mkdir(path.join(root,'src'));
  for(const name of ['a.ts','src/b.tsx','src/c.js'])await fs.writeFile(path.join(root,name),'needle');
  expect(await matches({pattern:'needle',glob:'*.{ts,tsx}'})).toEqual([path.join(root,'a.ts'),path.join(root,'src/b.tsx')]);
  expect(await matches({pattern:'needle',glob:'src/**/*.{tsx,js}'})).toEqual([path.join(root,'src/b.tsx'),path.join(root,'src/c.js')]);
  expect(await matches({pattern:'needle',glob:'*.py'})).toEqual([]);
 });
 it('returns deduplicated context lines without adding them to counts or matching files',async()=>{
  const file=path.join(root,'context.txt');await fs.writeFile(file,'before\nneedle\nbetween\nneedle\nafter');
  expect(await matches({pattern:'needle',output_mode:'content','-C':1})).toEqual(['before','needle','between','needle','after'].map((text,index)=>`${file}:${index+1}: ${text}`));
  expect(await matches({pattern:'needle',output_mode:'count','-C':1})).toEqual([`${file}: 2`]);
  expect(await matches({pattern:'needle',output_mode:'content','-C':2,'-B':0,'-A':0})).toEqual([`${file}:2: needle`,`${file}:4: needle`]);
  expect(await matches({pattern:'needle',output_mode:'content','-B':1,head_limit:2})).toEqual([`${file}:1: before`,`${file}:2: needle`]);
 });
 it('applies context around multiline matches',async()=>{
  const file=path.join(root,'multi.txt');await fs.writeFile(file,'before\nalpha\nbeta\nafter');
  expect(await matches({pattern:'alpha\\nbeta',multiline:true,output_mode:'content','-B':1,'-A':1})).toEqual(['before','alpha','beta','after'].map((text,index)=>`${file}:${index+1}: ${text}`));
 });
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
 it('matches across lines and returns each covered line once with its original number',async()=>{
  const file=path.join(root,'multiline.ts');await fs.writeFile(file,'before\nalpha\nbeta alpha\nbeta\nafter');
  expect(await matches({pattern:'alpha\\nbeta',multiline:true,output_mode:'content'})).toEqual([
   `${file}:2: alpha`,`${file}:3: beta alpha`,`${file}:4: beta`
  ]);
  expect(await matches({pattern:'alpha\\nbeta',multiline:true,output_mode:'count'})).toEqual([`${file}: 3`]);
  expect(await matches({pattern:'alpha\\nbeta',multiline:true})).toEqual([file]);
  expect(await matches({pattern:'alpha\\nbeta',multiline:true,output_mode:'content',head_limit:2})).toEqual([`${file}:2: alpha`,`${file}:3: beta alpha`]);
  expect(await matches({pattern:'alpha\\nbeta',multiline:false})).toEqual([]);
 });
 it('supports dotall, line anchors, case folding and zero-length matches in multiline mode',async()=>{
  const file=path.join(root,'anchors.txt');await fs.writeFile(file,'before\nALPHA\nbeta\nafter');
  expect(await matches({pattern:'^alpha.*beta$',multiline:true,'-i':true,output_mode:'content'})).toEqual([`${file}:2: ALPHA`,`${file}:3: beta`]);
  expect(await matches({pattern:'^',multiline:true,output_mode:'count'})).toEqual([`${file}: 4`]);
  expect(await matches({pattern:'ALPHA\\n',multiline:true,output_mode:'content'})).toEqual([`${file}:2: ALPHA`]);
 });
 it('does not search denied files or symlinks outside the permitted root',async()=>{
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'kairo-grep-denied-'));
  try{const file=path.join(outside,'private.ts');await fs.writeFile(file,'import\nprivate');const link=path.join(root,'link.ts');await fs.symlink(file,link);for(const multiline of [false,true]){expect(await matches({path:file,pattern:'import',multiline})).toEqual([]);expect(await matches({path:link,pattern:'import',multiline})).toEqual([]);expect(await matches({pattern:'import',multiline})).toEqual([]);}}finally{await fs.rm(outside,{recursive:true,force:true});}
 });
});

describe('permission-checked glob',()=>{
 it('finds images and documents while grep still excludes binary extensions and denied paths',async()=>{
  const files=['photo.png','guide.pdf','report.pdf','notes.md'];
  for(const name of files)await fs.writeFile(path.join(root,name),'needle');
  const permissions=createDefaultAgentPermissions();permissions.executionProfile='read_only_workspace';permissions.fileSystem={read:true,write:false,allowedPaths:[root]};
  const guard=new PermissionGuard(permissions);const check=guard.checkFileSystem.bind(guard);
  vi.spyOn(guard,'checkFileSystem').mockImplementation((file,mode)=>file!==path.join(root,'guide.pdf')&&check(file,mode));
  const tools=createCodebaseTools(root,guard);
  const result=await tools[1].execute({pattern:'**/*.{png,pdf,md}'}) as ToolSuccessResult<{matches:string[]}>;
  expect(result.ok).toBe(true);expect(result.data.matches.sort()).toEqual(['notes.md','photo.png','report.pdf'].map(name=>path.join(root,name)).sort());
  expect(await matches({pattern:'needle'})).toEqual([path.join(root,'notes.md')]);
 });
});

describe('literal file edits',()=>{
 it.each([false,true])('preserves replacement sequences with replace_all=%s',async replaceAll=>{
  const file=path.join(root,'edit.txt');
  const replacement='const replacement = "$& $$ $` $\' $1";';
  await fs.writeFile(file,replaceAll?'before\nbefore':'prefix before suffix');
  const result=await EditTool.execute({file_path:file,old_string:'before',new_string:replacement,replace_all:replaceAll}) as ToolSuccessResult<{occurrences:number}>;
  expect(result.ok).toBe(true);
  expect(result.data.occurrences).toBe(replaceAll?2:1);
  expect(await fs.readFile(file,'utf8')).toBe(replaceAll?`${replacement}\n${replacement}`:`prefix ${replacement} suffix`);
 });
});
