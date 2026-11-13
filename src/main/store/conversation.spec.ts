import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunSummary } from '../../shared/contracts';
const state = vi.hoisted(() => ({ db: null as unknown as DatabaseSync, run: null as unknown as RunSummary }));
vi.mock('./chat', () => ({ getDb: () => state.db, getRunById: (id: string) => ({ ...state.run, id }) }));
vi.mock('./taskPages', () => ({ getOwnedSessionSummary: (_: unknown, id: string) => id === 's' ? { id } : null }));
import { setConversationUser, recordConversationUpdate, getConversationPage, getConversationDetails, getConversationNavigation } from './conversation';
beforeEach(() => {
 state.db?.close(); state.db = new DatabaseSync(':memory:');
 state.db.exec(`CREATE TABLE runs(id TEXT PRIMARY KEY,session_id TEXT,status TEXT DEFAULT 'completed');INSERT INTO runs(id,session_id) VALUES('r','s');
 CREATE TABLE conversation_items(id TEXT PRIMARY KEY,run_id TEXT,sequence INTEGER,kind TEXT,content TEXT,status TEXT,details TEXT,metadata TEXT,UNIQUE(run_id,sequence));`);
 state.run={id:'r',sessionId:'s',agentId:'a',goal:'read',userInput:'read',status:'running',createdAt:1,updatedAt:1};
});
describe('persisted conversation', () => {
 it('returns the sent skill snapshot without needing the current skill catalog', () => {
  const skillMentions = [{ id: 'search', name: '发送时的技能名称' }];
  setConversationUser('r', '/search 今天的新闻', undefined, undefined, skillMentions);
  skillMentions[0].name = '已经改名';
  expect(getConversationPage('s').rounds[0].items[0]).toMatchObject({
   content: '/search 今天的新闻', skillMentions: [{ id: 'search', name: '发送时的技能名称' }]
  });
 });
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


describe('conversation navigation', () => {
 function seed(count: number) {
  const insert = state.db.prepare("INSERT INTO runs(id,session_id) VALUES(?,'s')");
  for (let index = 1; index <= count; index++) { insert.run(`r${index}`); setConversationUser(`r${index}`, `Question ${index}`); }
 }
 it('pages bounded previews in chronological order without exposing details or attachment metadata', () => {
  seed(125);
  state.db.prepare("UPDATE conversation_items SET content=?,details=?,metadata=? WHERE id='r125:user'").run('Q'.repeat(500), 'SECRET_DETAILS', JSON.stringify({ attachments: [{ name: 'SECRET_ATTACHMENT' }] }));
  state.db.prepare("INSERT INTO conversation_items VALUES('f','r125',1,'final',?,'completed',NULL,NULL)").run('A'.repeat(500));
  const page = getConversationNavigation('s');
  expect(page.entries).toHaveLength(100);
  expect(page.entries[0].runId).toBe('r26');
  expect(page.entries[page.entries.length - 1]).toMatchObject({ runId: 'r125', question: 'Q'.repeat(160), answer: 'A'.repeat(240) });
  expect(JSON.stringify(page)).not.toContain('SECRET');
  const older = getConversationNavigation('s', page.before);
  expect(older.entries).toHaveLength(25);
  expect(older.entries.map(entry => entry.runId)).not.toContain('r26');
  expect(older.before).toBeUndefined();
 });
 it('loads a selected old round and its following context without rendering the entire history', () => {
  seed(65);
  expect(getConversationPage('s').rounds[0].run.id).toBe('r46');
  const selected = getConversationPage('s', undefined, 'r5');
  expect(selected.rounds).toHaveLength(20);
  expect(selected.rounds[0].run.id).toBe('r5');
  expect(selected.rounds[selected.rounds.length - 1]?.run.id).toBe('r24');
  expect(getConversationPage('s', selected.before).rounds.map(round => round.run.id)).toEqual(['r1','r2','r3','r4']);
  expect(getConversationPage('s', undefined, 'r65').rounds.slice(-1)[0]?.run.id).toBe('r65');
 });
 it('rejects a foreign or empty round even when the session itself is valid', () => {
  state.db.prepare("INSERT INTO runs(id,session_id) VALUES('foreign','other')").run();
  setConversationUser('foreign','private');
  expect(() => getConversationNavigation('other')).toThrow('Task not found');
  expect(() => getConversationPage('s',undefined,'foreign')).toThrow('not found in this task');
  expect(() => getConversationPage('s',undefined,'r')).toThrow('not found in this task');
  expect(getConversationNavigation('s').entries).toEqual([]);
 });
});
