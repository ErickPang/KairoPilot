import {describe,it,expect,vi} from 'vitest';
import {initializeChatDatabase} from './chatDb';
function db(tables: string[],version?:number){return {prepare:vi.fn(()=>({all:()=>tables.map(name=>({name})),get:()=>({version})})),exec:vi.fn(),transaction:vi.fn((fn:()=>void)=>fn)};}
describe('current schema initialization boundary',()=>{
 it('creates schema in one transaction for a fresh database',()=>{const value=db([]);initializeChatDatabase(value as never);expect(value.transaction).toHaveBeenCalledOnce();expect(value.exec).toHaveBeenCalledOnce();});
 it('does not issue writes for an already current database',()=>{const value=db(['workbench_schema','sessions'],7);initializeChatDatabase(value as never);expect(value.exec).not.toHaveBeenCalled();expect(value.transaction).not.toHaveBeenCalled();});
 it('rejects unsupported databases before any write',()=>{for(const value of [db(['sessions']),db(['workbench_schema'],99)]){expect(()=>initializeChatDatabase(value as never)).toThrow('Unsupported database');expect(value.exec).not.toHaveBeenCalled();expect(value.transaction).not.toHaveBeenCalled();}});
});
