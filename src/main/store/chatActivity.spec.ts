vi.mock('./taskQueue',()=>({recoverTaskQueue:vi.fn()}));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextAssemblyMetadata } from '../core/context/assembler';

type TableRow = Record<string, unknown> & { rowid?: number };

const fakeDatabaseState = vi.hoisted(() => ({
  rows: {
    sessions: [] as TableRow[],
    app_state: [] as TableRow[],
    runs: [] as TableRow[],
    tool_call_records: [] as TableRow[],
    approval_records: [] as TableRow[],
    context_snapshots: [] as TableRow[],
    context_summaries: [] as TableRow[],
    messages: [] as TableRow[]
  },
  rowid: 0,
  reset() {
    this.rows.sessions = [];
    this.rows.app_state = [];
    this.rows.runs = [];
    this.rows.tool_call_records = [];
    this.rows.approval_records = [];
    this.rows.context_snapshots = [];
    this.rows.context_summaries = [];
    this.rows.messages = [];
    this.rowid = 0;
  },
  nextRowId() {
    this.rowid += 1;
    return this.rowid;
  }
}));

const auditStoreMocks = vi.hoisted(() => ({
  queryAuditLogs: vi.fn(() => ({ items: [] }))
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp'
  }
}));

vi.mock('fs', () => ({
  default: {
    existsSync: () => true,
    mkdirSync: () => undefined
  }
}));

vi.mock('./audit', () => ({
  queryAuditLogs: auditStoreMocks.queryAuditLogs
}));

vi.mock('./configRepository', () => ({ readKairoPilotConfig: () => ({workbench:{}}) }));



vi.mock('./chatDb', () => ({
  initializeChatDatabase: vi.fn()
}));

class FakeStatement {
  constructor(
    private readonly database: FakeDatabase,
    private readonly sql: string
  ) {}

  get(...args: unknown[]) {
    return this.database.handleGet(this.sql, args);
  }

  run(...args: unknown[]) {
    return this.database.handleRun(this.sql, args);
  }

  all(...args: unknown[]) {
    return this.database.handleAll(this.sql, args);
  }
}

class FakeDatabase {
  pragma() {
    return [];
  }

  exec() {}

  prepare(sql: string) {
    return new FakeStatement(this, normalizeSql(sql));
  }

  transaction<T>(callback: () => T) {
    return () => callback();
  }

  handleGet(sql: string, args: unknown[]) {
    if (sql === 'SELECT agent_id FROM sessions WHERE id = ?') {
      const row = findRow('sessions', 'id', args[0]);
      return row ? { agent_id: row.agent_id } : undefined;
    }

    if (sql === 'SELECT * FROM sessions WHERE id = ?') {
      return clone(findRow('sessions', 'id', args[0]));
    }

    if (sql === 'SELECT run_id, result, error, status FROM tool_call_records WHERE id = ?') {
      const row = findRow('tool_call_records', 'id', args[0]);
      return row
        ? {
            run_id: row.run_id,
            result: row.result ?? null,
            error: row.error ?? null,
            status: row.status
          }
        : undefined;
    }

    if (sql === 'SELECT run_id FROM approval_records WHERE id = ?') {
      const row = findRow('approval_records', 'id', args[0]);
      return row ? { run_id: row.run_id } : undefined;
    }

    if (sql === 'SELECT snapshot FROM context_snapshots WHERE run_id = ? ORDER BY created_at DESC LIMIT 1') {
      const rows = filterRows('context_snapshots', 'run_id', args[0]).sort(compareByNumber('created_at', 'desc'));
      return rows[0] ? { snapshot: rows[0].snapshot } : undefined;
    }

    if (sql === 'SELECT id, run_id, session_id, step_id, summary, created_at FROM context_summaries WHERE run_id = ? ORDER BY created_at DESC LIMIT 1') {
      const rows = filterRows('context_summaries', 'run_id', args[0]).sort(compareByNumber('created_at', 'desc'));
      return clone(rows[0]);
    }

    if (sql === 'SELECT * FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 1') {
      const rows = filterRows('sessions', 'agent_id', args[0]).sort(compareSessions);
      return clone(rows[0]);
    }

    if (sql === 'SELECT id, title, agent_id, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT 1') {
      const rows = [...fakeDatabaseState.rows.sessions].sort(compareSessions);
      return clone(rows[0]);
    }

    if (sql === 'SELECT id, run_id, step_id, session_id, tool_name, args, status, metadata, created_at, updated_at, resolved_at FROM approval_records WHERE id = ?') {
      return clone(findRow('approval_records', 'id', args[0]));
    }

    if (sql === 'SELECT id, session_id, agent_id, goal, user_input, status, final_response, error, waiting_approval_id, created_at, updated_at, started_at, completed_at, execution_context FROM runs WHERE id = ?') {
      return clone(findRow('runs', 'id', args[0]));
    }

    if (sql === 'SELECT id, session_id, agent_id, goal, user_input, status, final_response, error, waiting_approval_id, created_at, updated_at, started_at, completed_at, execution_context FROM runs WHERE session_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1') {
      const rows = filterRows('runs', 'session_id', args[0]).sort(compareRuns);
      return clone(rows[0]);
    }

    if (sql.includes("FROM approval_records") && sql.includes("status = 'pending'") && sql.includes('LIMIT 1')) {
      const scopedRows = sql.includes('WHERE session_id = ?')
        ? fakeDatabaseState.rows.approval_records.filter((row) => row.session_id === args[0] && row.status === 'pending')
        : fakeDatabaseState.rows.approval_records.filter((row) => row.status === 'pending');
      const rows = [...scopedRows].sort(compareApprovals);
      return clone(rows[0]);
    }

    throw new Error(`Unsupported SELECT: ${sql}`);
  }

  handleRun(sql: string, args: unknown[]) {
    if (sql.startsWith('INSERT INTO sessions (')) {
      insertRow('sessions', {
        id: args[0],
        title: args[1],
        agent_id: args[2],
        created_at: args[3],
        updated_at: args[4]
      });
      return;
    }

    if (sql === 'INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)') {
      upsertRow('app_state', 'key', {
        key: args[0],
        value: args[1]
      });
      return;
    }

    if (sql.startsWith('INSERT INTO runs (') && sql.includes('VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')) {
      insertRow('runs', {
        id: args[0],
        session_id: args[1],
        agent_id: args[2],
        goal: args[3],
        user_input: args[4],
        status: args[5],
        final_response: null,
        error: null,
        waiting_approval_id: null,
        created_at: args[6],
        updated_at: args[7],
        started_at: args[8],
        completed_at: null
      });
      return;
    }

    if (sql === "UPDATE sessions SET title = ? WHERE id = ? AND (title = 'New Chat' OR trim(title) = '')") {
      const row = findRow('sessions', 'id', args[1]);
      if (row && (row.title === 'New Chat' || !String(row.title).trim())) row.title = args[0];
      return;
    }

    if (sql === 'UPDATE sessions SET updated_at = ? WHERE id = ?') {
      const row = findRow('sessions', 'id', args[1]);
      if (row) {
        row.updated_at = args[0];
      }
      return;
    }

    if (sql === 'UPDATE runs SET updated_at = ? WHERE id = ?') {
      const row = findRow('runs', 'id', args[1]);
      if (row) {
        row.updated_at = args[0];
      }
      return;
    }

    if (sql === 'UPDATE runs SET status = ?, final_response = ?, error = ?, waiting_approval_id = ?, started_at = ?, completed_at = ?, updated_at = ? WHERE id = ?') {
      const row = findRow('runs', 'id', args[7]);
      if (row) {
        row.status = args[0];
        row.final_response = args[1];
        row.error = args[2];
        row.waiting_approval_id = args[3];
        row.started_at = args[4];
        row.completed_at = args[5];
        row.updated_at = args[6];
      }
      return;
    }

    if (sql.startsWith('INSERT INTO tool_call_records (') && sql.includes('VALUES (?, ?, ?, ?, ?, ?, ?, ?)')) {
      insertRow('tool_call_records', {
        id: args[0],
        run_id: args[1],
        step_id: args[2],
        tool_name: args[3],
        args: args[4],
        result: null,
        error: null,
        status: args[5],
        created_at: args[6],
        updated_at: args[7]
      });
      return;
    }

    if (sql === 'UPDATE tool_call_records SET result = ?, error = ?, status = ?, updated_at = ? WHERE id = ?') {
      const row = findRow('tool_call_records', 'id', args[4]);
      if (row) {
        row.result = args[0];
        row.error = args[1];
        row.status = args[2];
        row.updated_at = args[3];
      }
      return;
    }

    if (sql.startsWith('INSERT INTO approval_records (') && sql.includes('VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')) {
      insertRow('approval_records', {
        id: args[0],
        run_id: args[1],
        step_id: args[2],
        session_id: args[3],
        tool_name: args[4],
        args: args[5],
        status: args[6],
        metadata: args[7],
        created_at: args[8],
        updated_at: args[9],
        resolved_at: null
      });
      return;
    }

    if (sql === 'UPDATE approval_records SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?') {
      const row = findRow('approval_records', 'id', args[3]);
      if (row) {
        row.status = args[0];
        row.updated_at = args[1];
        row.resolved_at = args[2];
      }
      return;
    }

    if (sql.startsWith('INSERT INTO context_snapshots (') && sql.includes('VALUES (?, ?, ?, ?, ?)')) {
      insertRow('context_snapshots', {
        id: args[0],
        run_id: args[1],
        step_id: args[2],
        snapshot: args[3],
        created_at: args[4]
      });
      return;
    }

    if (sql.startsWith('INSERT INTO context_summaries (') && sql.includes('VALUES (?, ?, ?, ?, ?, ?)')) {
      insertRow('context_summaries', {
        id: args[0],
        run_id: args[1],
        session_id: args[2],
        step_id: args[3],
        summary: args[4],
        created_at: args[5]
      });
      return;
    }

    throw new Error(`Unsupported RUN: ${sql}`);
  }

  handleAll(sql: string, args: unknown[]) {
    if (sql === 'SELECT role, content, timestamp, name, tool_call_id, tool_calls, attachments, context_refs, usage, model FROM messages WHERE session_id = ? ORDER BY timestamp ASC, rowid ASC') {
      return [];
    }

    if (sql === 'SELECT id, title, agent_id, created_at, updated_at FROM sessions ORDER BY updated_at DESC') {
      return [...fakeDatabaseState.rows.sessions].sort(compareSessions).map(clone);
    }

    if (sql === 'SELECT id, title, agent_id, created_at, updated_at FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC') {
      return filterRows('sessions', 'agent_id', args[0]).sort(compareSessions).map(clone);
    }

    if (sql.startsWith('SELECT id, title, agent_id, created_at, updated_at, project_id, execution_root, archived_at, activity_version, read_version, ')) {
      const sessions = sql.includes('FROM sessions WHERE agent_id = ?') ? filterRows('sessions', 'agent_id', args[0]) : [...fakeDatabaseState.rows.sessions];
      return sessions.sort(compareSessions).map((session) => {
        const latest = fakeDatabaseState.rows.runs.filter((run) => run.session_id === session.id && run.agent_id === session.agent_id).sort(compareRuns)[0];
        return { ...clone(session), run_status: latest?.status };
      });
    }
    throw new Error(`Unsupported ALL: ${sql}`);
  }
}

vi.mock('better-sqlite3', () => ({
  default: FakeDatabase
}));

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

function insertRow(table: keyof typeof fakeDatabaseState.rows, row: TableRow) {
  fakeDatabaseState.rows[table].push({
    ...row,
    rowid: fakeDatabaseState.nextRowId()
  });
}

function upsertRow(table: keyof typeof fakeDatabaseState.rows, key: string, row: TableRow) {
  const existing = fakeDatabaseState.rows[table].find((item) => item[key] === row[key]);
  if (existing) {
    Object.assign(existing, row);
    return;
  }

  insertRow(table, row);
}

function findRow(table: keyof typeof fakeDatabaseState.rows, key: string, value: unknown) {
  return fakeDatabaseState.rows[table].find((row) => row[key] === value);
}

function filterRows(table: keyof typeof fakeDatabaseState.rows, key: string, value: unknown) {
  return fakeDatabaseState.rows[table].filter((row) => row[key] === value);
}

function clone<T>(value: T): T {
  return value ? JSON.parse(JSON.stringify(value)) as T : value;
}

function compareByNumber(key: string, direction: 'asc' | 'desc') {
  return (left: TableRow, right: TableRow) => {
    const delta = Number(left[key] ?? 0) - Number(right[key] ?? 0);
    return direction === 'asc' ? delta : -delta;
  };
}

function compareSessions(left: TableRow, right: TableRow) {
  const updatedDelta = Number(right.updated_at ?? 0) - Number(left.updated_at ?? 0);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  const createdDelta = Number(right.created_at ?? 0) - Number(left.created_at ?? 0);
  if (createdDelta !== 0) {
    return createdDelta;
  }

  return String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

function compareRuns(left: TableRow, right: TableRow) {
  const updatedDelta = Number(right.updated_at ?? 0) - Number(left.updated_at ?? 0);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  return Number(right.created_at ?? 0) - Number(left.created_at ?? 0);
}

function compareApprovals(left: TableRow, right: TableRow) {
  const updatedDelta = Number(right.updated_at ?? 0) - Number(left.updated_at ?? 0);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }

  const createdDelta = Number(right.created_at ?? 0) - Number(left.created_at ?? 0);
  if (createdDelta !== 0) {
    return createdDelta;
  }

  return Number(right.rowid ?? 0) - Number(left.rowid ?? 0);
}

function createContextSummary(overrides: Partial<ContextAssemblyMetadata> = {}): ContextAssemblyMetadata {
  return {
    activeTaskSummary: 'task',
    activeSkillsSummary: '',
    availableSkillsSummary: '',
    availableToolsSummary: 'read_file',
    compactedHistorySummary: '',
    unresolvedApprovals: '',
    selectedToolResults: '',
    workspaceRetrieval: '',
    memoryDigest: '',
    layers: [],
    recentMessageCount: 1,
    omittedMessageCount: 0,
    budget: {
      maxContextChars: 1000,
      systemPromptChars: 100,
      supportChars: 200,
      recentHistoryChars: 300,
      totalChars: 600
    },
    ...overrides
  };
}

describe('chat activity persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    fakeDatabaseState.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('工具、审批和上下文写入都会刷新 run/session 活动时间与最近排序', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const chat = await import('./chat');

    const sessionA = chat.createSession('Session A', 'agent-1');
    now = 2_000;
    const sessionB = chat.createSession('Session B', 'agent-1');
    now = 3_000;
    const runA = chat.createRun(sessionA.id, 'agent-1', 'task-a');
    now = 4_000;
    chat.createRun(sessionB.id, 'agent-1', 'task-b');

    expect(chat.listSessions('agent-1').map((session) => session.id)).toEqual([sessionB.id, sessionA.id]);

    now = 5_000;
    const toolRecordId = chat.createToolCallRecord(runA.id, null, 'read_file', { path: '/tmp/a.txt' });
    expect(chat.getRunById(runA.id)?.updatedAt).toBe(5_000);
    expect(chat.listSessions('agent-1')[0]?.id).toBe(sessionA.id);
    expect(chat.getLatestRun(sessionA.id)?.updatedAt).toBe(5_000);

    now = 6_000;
    chat.updateToolCallRecord(toolRecordId, {
      status: 'success',
      result: { ok: true }
    });
    expect(chat.getRunById(runA.id)?.updatedAt).toBe(6_000);

    now = 7_000;
    const approval = chat.createApprovalRecord({
      runId: runA.id,
      sessionId: sessionA.id,
      toolName: 'delete_file',
      toolArgs: { path: '/tmp/a.txt' }
    });
    expect(chat.getRunById(runA.id)?.updatedAt).toBe(7_000);
    expect(chat.getPendingApproval(sessionA.id)?.id).toBe(approval.id);

    now = 8_000;
    chat.saveContextSnapshot(runA.id, { checkpoint: true });
    expect(chat.getRunById(runA.id)?.updatedAt).toBe(8_000);
    expect(chat.getLatestContextSnapshot<{ checkpoint: boolean }>(runA.id)).toEqual({ checkpoint: true });

    now = 9_000;
    chat.saveRunContextSummary(runA.id, createContextSummary({
      unresolvedApprovals: 'delete_file /tmp/a.txt'
    }));
    expect(chat.getRunById(runA.id)?.updatedAt).toBe(9_000);
    expect(chat.getLatestRunContextSummary(runA.id)).toEqual(expect.objectContaining({
      unresolvedApprovals: 'delete_file /tmp/a.txt'
    }));
    expect(chat.listSessions('agent-1')[0]?.id).toBe(sessionA.id);

    now = 10_000;
    chat.resolveApprovalRecord(approval.id, true);
    expect(chat.getRunById(runA.id)?.updatedAt).toBe(10_000);
    expect(chat.getLatestRun(sessionA.id)).toEqual(expect.objectContaining({
      id: runA.id,
      updatedAt: 10_000
    }));
  });

  it('同毫秒内多个待审批记录会按最新插入顺序返回', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const chat = await import('./chat');
    const session = chat.createSession('Approval Session', 'agent-1');
    const run = chat.createRun(session.id, 'agent-1', 'task');

    const first = chat.createApprovalRecord({
      runId: run.id,
      sessionId: session.id,
      toolName: 'delete_file',
      toolArgs: { path: '/tmp/first.txt' }
    });
    const second = chat.createApprovalRecord({
      runId: run.id,
      sessionId: session.id,
      toolName: 'delete_file',
      toolArgs: { path: '/tmp/second.txt' }
    });

    expect(chat.getPendingApproval(session.id)).toEqual(expect.objectContaining({
      id: second.id,
      args: { path: '/tmp/second.txt' }
    }));
    expect(first.id).not.toBe(second.id);
  });

  it('阻止无效 run 状态转移并在离开审批态时清理 waitingApprovalId', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const chat = await import('./chat');
    const session = chat.createSession('State Session', 'agent-1');
    const run = chat.createRun(session.id, 'agent-1', 'task');

    now = 2_000;
    const waitingRun = chat.updateRun(run.id, {
      status: 'waiting_approval',
      waitingApprovalId: 'approval-1'
    });
    expect(waitingRun).toEqual(expect.objectContaining({
      status: 'waiting_approval',
      waitingApprovalId: 'approval-1'
    }));

    now = 3_000;
    const completedRun = chat.updateRun(run.id, {
      status: 'completed',
      finalResponse: 'done'
    });
    expect(completedRun).toEqual(expect.objectContaining({
      status: 'completed',
      completedAt: 3_000
    }));
    expect(completedRun?.waitingApprovalId).toBeUndefined();

    expect(() => chat.updateRun(run.id, {
      status: 'cancelled'
    })).toThrow('Invalid run status transition: completed -> cancelled');
  });
});
