import {describe,it,expect,vi} from 'vitest';
import {initializeChatDatabase} from './chatDb';
function db(tables: string[],version?:number){return {prepare:vi.fn(()=>({all:()=>tables.map(name=>({name})),get:()=>({version})})),exec:vi.fn((_sql:string)=>{}),transaction:vi.fn((fn:()=>void)=>fn)};}
describe('current schema initialization boundary',()=>{
 it('creates schema in one transaction for a fresh database',()=>{const value=db([]);initializeChatDatabase(value as never);expect(value.transaction).toHaveBeenCalledOnce();expect(value.exec).toHaveBeenCalledTimes(3);});
 it('creates additive conversation and approval storage for a current database',()=>{const value=db(['workbench_schema','sessions'],7);initializeChatDatabase(value as never);expect(value.exec).toHaveBeenCalledTimes(2);expect(value.exec.mock.calls[0]?.[0]).toMatch(/^CREATE TABLE IF NOT EXISTS conversation_items/);expect(value.exec.mock.calls[1]?.[0]).toMatch(/^CREATE TABLE IF NOT EXISTS session_approval_grants/);expect(value.transaction).not.toHaveBeenCalled();});
 it('rejects unsupported databases before any write',()=>{for(const value of [db(['sessions']),db(['workbench_schema'],99)]){expect(()=>initializeChatDatabase(value as never)).toThrow('Unsupported database');expect(value.exec).not.toHaveBeenCalled();expect(value.transaction).not.toHaveBeenCalled();}});
});
