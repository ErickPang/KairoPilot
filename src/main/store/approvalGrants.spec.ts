import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
const state = vi.hoisted(() => ({ db: null as unknown as DatabaseSync }));
const database = () => ({
  prepare: (sql: string) => state.db.prepare(sql),
  exec: (sql: string) => state.db.exec(sql),
  transaction: (operation: () => void) => () => { state.db.exec('BEGIN'); try { operation(); state.db.exec('COMMIT'); } catch (error) { state.db.exec('ROLLBACK'); throw error; } }
});
vi.mock('./chat', () => ({ getDb: () => database() }));
import { initializeChatDatabase } from './chatDb';
import { clearSessionApprovalGrants, sessionApprovalPolicy } from './approvalGrants';

beforeEach(() => {
  state.db = new DatabaseSync(':memory:');
  state.db.exec('PRAGMA foreign_keys=ON');
  initializeChatDatabase(database() as unknown as Database.Database);
  state.db.exec(`INSERT INTO sessions(id,title,created_at,updated_at) VALUES('s','Task',1,1),('other','Other',1,1);
    INSERT INTO runs(id,session_id,agent_id,goal,user_input,status,created_at,updated_at) VALUES('r','s','workbench','goal','input','completed',1,1);
    INSERT INTO approval_records(id,run_id,session_id,tool_name,args,status,metadata,created_at,updated_at) VALUES('approved','r','s','write_file','{}','approved','{"riskLevel":"high"}',1,1),('pending','r','s','write_file','{}','pending','{}',1,1);`);
});
afterEach(() => state.db.close());

describe('persisted conversation approvals', () => {
  it('isolates conversation and permission context, survives reinitialization, and records the decision scope', () => {
    const policy = sessionApprovalPolicy('s', 'permissions-and-directory');
    policy.remember('operation', 'approved');
    initializeChatDatabase(database() as unknown as Database.Database);
    expect(sessionApprovalPolicy('s', 'permissions-and-directory').allows('operation')).toBe(true);
    expect(sessionApprovalPolicy('other', 'permissions-and-directory').allows('operation')).toBe(false);
    expect(sessionApprovalPolicy('s', 'changed-permissions').allows('operation')).toBe(false);
    expect(JSON.parse((state.db.prepare('SELECT metadata FROM approval_records WHERE id=?').get('approved') as {metadata:string}).metadata)).toEqual({riskLevel:'high',decisionScope:'session'});
    clearSessionApprovalGrants('s');
    expect(policy.allows('operation')).toBe(false);
  });
  it('rejects unresolved or cross-conversation approvals, and cascades deletion with the task', () => {
    expect(()=>sessionApprovalPolicy('s','context').remember('op','pending')).toThrow();
    expect(()=>sessionApprovalPolicy('other','context').remember('op','approved')).toThrow();
    sessionApprovalPolicy('s','context').remember('op','approved');
    state.db.prepare('DELETE FROM sessions WHERE id=?').run('s');
    expect(state.db.prepare('SELECT * FROM session_approval_grants').all()).toEqual([]);
  });
});
