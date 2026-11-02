import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSummary } from '../../shared/contracts';
const state = vi.hoisted(() => ({ db: null as unknown as DatabaseSync, run: null as unknown as RunSummary }));
vi.mock('./chat', () => ({ getDb: () => state.db, getRunById: () => state.run }));
vi.mock('./taskPages', () => ({ getOwnedSessionSummary: (_: unknown, id: string) => id === 's' ? { id } : null }));
import { setConversationUser, recordConversationUpdate, getConversationPage, getConversationDetails } from './conversation';
beforeEach(() => {
 state.db?.close(); state.db = new DatabaseSync(':memory:');
 state.db.exec(`CREATE TABLE runs(id TEXT PRIMARY KEY,session_id TEXT);INSERT INTO runs VALUES('r','s');
 CREATE TABLE conversation_items(id TEXT PRIMARY KEY,run_id TEXT,sequence INTEGER,kind TEXT,content TEXT,status TEXT,details TEXT,metadata TEXT,UNIQUE(run_id,sequence));`);
 state.run={id:'r',sessionId:'s',agentId:'a',goal:'read',userInput:'read',status:'running',createdAt:1,updatedAt:1};
});
describe('persisted conversation', () => {
 it('keeps streaming identity, commentary order and a distinct final across reloads', () => {
  setConversationUser('r','read');
  recordConversationUpdate({type:'assistant-delta',runId:'r',stepId:'m1',delta:'checking',content:'checking'});
  recordConversationUpdate({type:'assistant-message',runId:'r',stepId:'m1',phase:'commentary',content:'checking now'});
  recordConversationUpdate({type:'assistant-delta',runId:'r',stepId:'m2',delta:'answer',content:'answer'});
  recordConversationUpdate({type:'assistant-response',runId:'r',status:'completed',content:'final answer'});
  const items=getConversationPage('s').rounds[0].items;
  expect(items.map(item=>[item.kind,item.content])).toEqual([['user','read'],['commentary','checking now'],['final','final answer']]);
  expect(new Set(items.map(item=>item.id)).size).toBe(3);
  expect(getConversationPage('s').rounds[0].run).not.toHaveProperty('executionContext');
  expect(getConversationPage('s').rounds[0].run).not.toHaveProperty('goal');
 });
 it('updates a failed tool once and keeps a retry separate, with task-scoped lazy details', () => {
  recordConversationUpdate({type:'tool-call',runId:'r',callId:'c1',tool:'load_skill',args:{name:'skill'}});
  recordConversationUpdate({type:'tool-error',runId:'r',callId:'c1',tool:'load_skill',error:'bad argument'});
  recordConversationUpdate({type:'tool-call',runId:'r',callId:'c2',tool:'load_skill',args:{name:'skill'}});
  recordConversationUpdate({type:'tool-result',runId:'r',callId:'c2',tool:'load_skill',result:'loaded'});
  const tools=getConversationPage('s').rounds[0].items.filter(item=>item.kind==='tool');
  expect(tools.map(item=>item.status)).toEqual(['failed','completed']);
  expect(tools[0]).not.toHaveProperty('details');
  expect(tools[1].activity).toEqual({action:'tool',target:'load_skill skill',icon:'tool'});
  expect(getConversationDetails('s',tools[1].id)).toEqual({output:'loaded',error:''});
  expect(getConversationDetails('s',tools[0].id)).toEqual({output:'',error:'bad argument'});
  expect(()=>getConversationDetails('foreign',tools[0].id)).toThrow();
 });
});
