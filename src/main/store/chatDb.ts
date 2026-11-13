import type Database from 'better-sqlite3';
/** Create the complete schema once; subsequent starts validate without repairing it. */
export function initializeChatDatabase(database: Database.Database) {
 const tables=database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>;
 if(tables.some(table=>table.name!=='audit_logs')) {
  const names=new Set(tables.map(table=>table.name));
  if(!names.has('workbench_schema'))throw new Error('Unsupported database schema.');
  const versions=database.prepare('SELECT version FROM workbench_schema').all() as Array<{version:number}>;
  if(versions.length!==1 || versions[0].version!==7)throw new Error('Unsupported database schema.');
  for(const [name,expected] of Object.entries(REQUIRED_COLUMNS)) {
   if(!names.has(name))throw new Error(`Incomplete database schema: ${name}.`);
   const columns=database.prepare(`PRAGMA table_info("${name}")`).all() as Array<{name:string}>;
   const actual=new Set(columns.map(column=>column.name));
   const missing=expected.filter(column=>!actual.has(column));
   const unexpected=columns.map(column=>column.name).filter(column=>!expected.includes(column) && !RETIRED_COLUMNS[name]?.includes(column));
   if(missing.length || unexpected.length)throw new Error(`Invalid database columns: ${name}. Missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`);
  }
  const objects=new Set((database.prepare("SELECT name FROM sqlite_master WHERE type IN ('index','trigger')").all() as Array<{name:string}>).map(item=>item.name));
  if(REQUIRED_OBJECTS.some(name=>!objects.has(name)))throw new Error('Incomplete database indexes or triggers.');
  return;
 }
 database.transaction(()=>{database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      agent_id TEXT,
      project_id TEXT REFERENCES projects(id),
      execution_root TEXT,
      execution_settings TEXT,
      archived_at INTEGER,
      activity_version INTEGER NOT NULL DEFAULT 0,
      read_version INTEGER NOT NULL DEFAULT 0,
      message_generation INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      name TEXT,
      tool_call_id TEXT,
      tool_calls TEXT,
      attachments TEXT,
      usage TEXT,
      model TEXT,
      context_refs TEXT,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      kind TEXT NOT NULL,
      original_path TEXT,
      stored_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      preview_uri TEXT,
      extracted_text TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      user_input TEXT NOT NULL,
      status TEXT NOT NULL,
      final_response TEXT,
      execution_context TEXT,
      error TEXT,
      waiting_approval_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      input TEXT,
      output TEXT,
      error TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_call_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      tool_name TEXT NOT NULL,
      args TEXT,
      result TEXT,
      error TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES run_steps(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS approval_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      session_id TEXT,
      tool_name TEXT NOT NULL,
      args TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      resolved_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES run_steps(id) ON DELETE SET NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS context_snapshots (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_id TEXT,
      snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES run_steps(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS context_summaries (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      session_id TEXT,
      step_id TEXT,
      summary TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (step_id) REFERENCES run_steps(id) ON DELETE SET NULL
    );
  CREATE TABLE workbench_schema(version INTEGER NOT NULL); INSERT INTO workbench_schema VALUES(7);
CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,root_path TEXT NOT NULL,created_at INTEGER NOT NULL,previous_project_id TEXT REFERENCES projects(id),memory TEXT NOT NULL DEFAULT '');
CREATE TABLE project_authorizations(project_id TEXT PRIMARY KEY REFERENCES projects(id),root_path TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE task_artifacts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,data TEXT NOT NULL,old_text TEXT,new_text TEXT);
CREATE INDEX idx_task_artifacts_session ON task_artifacts(session_id);
CREATE TABLE verification_records(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,data TEXT NOT NULL);
CREATE INDEX idx_verification_session ON verification_records(session_id);
CREATE TABLE context_references(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,data TEXT NOT NULL);
CREATE INDEX idx_context_references_session ON context_references(session_id);
CREATE TABLE task_drafts(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,revision INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TRIGGER session_activity_revision AFTER UPDATE OF updated_at ON sessions BEGIN UPDATE sessions SET activity_version=OLD.activity_version+1 WHERE id=NEW.id; END;
CREATE INDEX idx_sessions_project_activity ON sessions(agent_id,project_id,updated_at DESC,id DESC);
CREATE INDEX idx_messages_session_time ON messages(session_id,timestamp DESC);
CREATE INDEX idx_workbench_task_activity ON sessions(project_id,updated_at DESC,id DESC);
CREATE TABLE task_templates(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE task_plans(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,revision INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);
   CREATE INDEX idx_task_plans_session ON task_plans(session_id);

CREATE TABLE project_memory_settings(project_id TEXT PRIMARY KEY REFERENCES projects(id),enabled INTEGER NOT NULL,epoch INTEGER NOT NULL);
      CREATE TABLE project_memories(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),data TEXT NOT NULL);
      CREATE INDEX idx_project_memories ON project_memories(project_id);
      CREATE TABLE intelligence_jobs(run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,status TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE delegated_tasks(id TEXT PRIMARY KEY,parent_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,status TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX idx_delegated_tasks ON delegated_tasks(session_id,parent_run_id);
      CREATE TABLE auxiliary_usage(id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,purpose TEXT NOT NULL,model TEXT NOT NULL,usage TEXT NOT NULL,timestamp INTEGER NOT NULL);

CREATE TABLE task_message_queue(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,draft_revision INTEGER NOT NULL,position INTEGER NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(session_id,draft_revision));
   CREATE INDEX idx_task_message_queue ON task_message_queue(status,session_id,position);


    CREATE INDEX IF NOT EXISTS idx_sessions_agent_updated_at
      ON sessions(agent_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_session_timestamp
      ON messages(session_id, timestamp ASC);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_session
      ON message_attachments(session_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_message_attachments_message
      ON message_attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_runs_session_updated_at
      ON runs(session_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_steps_run_step_index
      ON run_steps(run_id, step_index ASC);
    CREATE INDEX IF NOT EXISTS idx_tool_call_records_run_step
      ON tool_call_records(run_id, step_id);
    CREATE INDEX IF NOT EXISTS idx_approval_records_run_status
      ON approval_records(run_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_approval_records_session_status
      ON approval_records(session_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_context_snapshots_run_created_at
      ON context_snapshots(run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_context_summaries_run_created_at
      ON context_summaries(run_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_context_summaries_session_created_at
      ON context_summaries(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversation_items (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
    details TEXT, metadata TEXT, UNIQUE(run_id, sequence));
    CREATE INDEX IF NOT EXISTS idx_conversation_items_run ON conversation_items(run_id, sequence);
CREATE TABLE IF NOT EXISTS session_approval_grants (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    context TEXT NOT NULL, operation TEXT NOT NULL,
    approval_id TEXT NOT NULL REFERENCES approval_records(id) ON DELETE CASCADE,
    PRIMARY KEY(session_id,context,operation));`);})();
}

// Earlier schema-7 databases added columns using ALTER TABLE and retained these unused fields.
// Validate names without depending on physical column order; never remove or rewrite stored data.
const RETIRED_COLUMNS: Record<string,string[]> = { sessions: ['binding_id'], projects: ['rules'] };
const REQUIRED_COLUMNS: Record<string,string[]> = {
  "sessions": ["id","title","agent_id","project_id","execution_root","execution_settings","archived_at","activity_version","read_version","message_generation","created_at","updated_at"],
  "messages": ["id","session_id","role","content","name","tool_call_id","tool_calls","attachments","usage","model","context_refs","timestamp"],
  "message_attachments": ["id","session_id","message_id","name","mime_type","size","kind","original_path","stored_path","content_hash","preview_uri","extracted_text","created_at"],
  "app_state": ["key","value"],
  "runs": ["id","session_id","agent_id","goal","user_input","status","final_response","execution_context","error","waiting_approval_id","created_at","updated_at","started_at","completed_at"],
  "run_steps": ["id","run_id","step_index","type","status","title","input","output","error","metadata","created_at","updated_at"],
  "tool_call_records": ["id","run_id","step_id","tool_name","args","result","error","status","created_at","updated_at"],
  "approval_records": ["id","run_id","step_id","session_id","tool_name","args","status","metadata","created_at","updated_at","resolved_at"],
  "context_snapshots": ["id","run_id","step_id","snapshot","created_at"],
  "context_summaries": ["id","run_id","session_id","step_id","summary","created_at"],
  "workbench_schema": ["version"],
  "projects": ["id","name","root_path","created_at","previous_project_id","memory"],
  "project_authorizations": ["project_id","root_path","enabled"],
  "task_artifacts": ["id","run_id","session_id","data","old_text","new_text"],
  "verification_records": ["id","run_id","session_id","data"],
  "context_references": ["id","session_id","data"],
  "task_drafts": ["session_id","revision","data"],
  "task_templates": ["id","data"],
  "task_plans": ["id","session_id","revision","status","data"],
  "project_memory_settings": ["project_id","enabled","epoch"],
  "project_memories": ["id","project_id","data"],
  "intelligence_jobs": ["run_id","status","data"],
  "delegated_tasks": ["id","parent_run_id","session_id","status","data"],
  "auxiliary_usage": ["id","run_id","session_id","purpose","model","usage","timestamp"],
  "task_message_queue": ["id","session_id","draft_revision","position","status","revision","data"],
  "conversation_items": ["id","run_id","sequence","kind","content","status","details","metadata"],
  "session_approval_grants": ["session_id","context","operation","approval_id"],
};
const REQUIRED_OBJECTS = ["idx_task_artifacts_session", "idx_verification_session", "idx_context_references_session", "idx_sessions_project_activity", "idx_messages_session_time", "idx_workbench_task_activity", "idx_task_plans_session", "idx_project_memories", "idx_delegated_tasks", "idx_task_message_queue", "idx_sessions_agent_updated_at", "idx_messages_session_timestamp", "idx_message_attachments_session", "idx_message_attachments_message", "idx_runs_session_updated_at", "idx_run_steps_run_step_index", "idx_tool_call_records_run_step", "idx_approval_records_run_status", "idx_approval_records_session_status", "idx_context_snapshots_run_created_at", "idx_context_summaries_run_created_at", "idx_context_summaries_session_created_at", "idx_conversation_items_run", "session_activity_revision"];
