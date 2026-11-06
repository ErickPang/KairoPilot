import type Database from 'better-sqlite3';
/** The workbench creates its current schema directly; existing incompatible databases are never rewritten. */
export function initializeChatDatabase(database: Database.Database) {
 const tables=database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>;
 if(tables.some(table=>table.name!=='audit_logs')){
  if(!tables.some(table=>table.name==='workbench_schema'))throw new Error('Unsupported database schema. Use a fresh data directory.');
  const version=database.prepare('SELECT version FROM workbench_schema').get() as {version:number}|undefined;
  if(version?.version!==7)throw new Error('Unsupported database schema. Use a fresh data directory.');
  initializeConversationStorage(database);
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
  `);initializeConversationStorage(database);})();
}

function initializeConversationStorage(database: Database.Database) {
  database.exec(`CREATE TABLE IF NOT EXISTS conversation_items (
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
    details TEXT, metadata TEXT, UNIQUE(run_id, sequence));
    CREATE INDEX IF NOT EXISTS idx_conversation_items_run ON conversation_items(run_id, sequence);`);
  database.exec(`CREATE TABLE IF NOT EXISTS session_approval_grants (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    context TEXT NOT NULL, operation TEXT NOT NULL,
    approval_id TEXT NOT NULL REFERENCES approval_records(id) ON DELETE CASCADE,
    PRIMARY KEY(session_id,context,operation));`);
}
