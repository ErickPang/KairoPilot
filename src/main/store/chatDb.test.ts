import Database from 'better-sqlite3';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {initializeChatDatabase} from './chatDb';
const databases: Database.Database[]=[];
function fresh(){const db=new Database(':memory:');databases.push(db);return db;}
afterEach(()=>{databases.splice(0).forEach(db=>db.close());});
describe('current schema initialization boundary',()=>{
 it('creates the complete schema once and performs no schema writes on restart',()=>{
  const db=fresh();initializeChatDatabase(db);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('conversation_items','session_approval_grants')").all()).toHaveLength(2);
  const exec=vi.spyOn(db,'exec');initializeChatDatabase(db);expect(exec).not.toHaveBeenCalled();
 });
 it('rejects an incomplete database without repairing it',()=>{
  const db=fresh();initializeChatDatabase(db);db.exec('DROP TABLE conversation_items');
  const exec=vi.spyOn(db,'exec');expect(()=>initializeChatDatabase(db)).toThrow('Incomplete database');expect(exec).not.toHaveBeenCalled();
 });
 it('rejects missing indexes and malformed columns without modifying data',()=>{
  const db=fresh();initializeChatDatabase(db);db.exec('DROP INDEX idx_conversation_items_run');expect(()=>initializeChatDatabase(db)).toThrow('Incomplete database indexes');
  const other=fresh();initializeChatDatabase(other);other.exec('ALTER TABLE conversation_items ADD COLUMN unexpected TEXT');expect(()=>initializeChatDatabase(other)).toThrow('Invalid database columns');
 });
 it('accepts the existing schema-7 column order and retained fields without rewriting them',()=>{
  const source=fresh();initializeChatDatabase(source);
  const target=fresh();
  const definitions=source.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid").all() as Array<{name:string;sql:string}>;
  for(const definition of definitions) {
   let sql=definition.sql;
   if(definition.name==='sessions')sql=`CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,agent_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,project_id TEXT REFERENCES projects(id),binding_id TEXT,execution_root TEXT,archived_at INTEGER,activity_version INTEGER NOT NULL DEFAULT 0,read_version INTEGER NOT NULL DEFAULT 0,message_generation INTEGER NOT NULL DEFAULT 0,execution_settings TEXT)`;
   if(definition.name==='projects')sql=`CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,root_path TEXT NOT NULL,created_at INTEGER NOT NULL,previous_project_id TEXT REFERENCES projects(id),rules TEXT NOT NULL DEFAULT '',memory TEXT NOT NULL DEFAULT '')`;
   target.exec(sql);
  }
  target.exec("INSERT INTO workbench_schema VALUES(7); INSERT INTO sessions(id,title,created_at,updated_at,binding_id) VALUES('proof','Retained task',1,1,'retained-binding')");
  const before=target.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
  const exec=vi.spyOn(target,'exec');initializeChatDatabase(target);
  expect(exec).not.toHaveBeenCalled();expect(target.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(before);
  expect(target.prepare('SELECT binding_id FROM sessions WHERE id=?').get('proof')).toEqual({binding_id:'retained-binding'});
 });
 it('still rejects missing required columns and reports the precise difference',()=>{
  const db=fresh();initializeChatDatabase(db);db.exec('ALTER TABLE sessions RENAME COLUMN execution_settings TO unknown_settings');
  expect(()=>initializeChatDatabase(db)).toThrow('Missing: execution_settings; unexpected: unknown_settings');
 });
 it('rejects unsupported version markers before any write',()=>{
  const db=fresh();db.exec('CREATE TABLE workbench_schema(version); INSERT INTO workbench_schema VALUES(99)');
  const exec=vi.spyOn(db,'exec');expect(()=>initializeChatDatabase(db)).toThrow('Unsupported database');expect(exec).not.toHaveBeenCalled();
 });
});
