import fs from 'node:fs';
import path from 'node:path';
import {readAgentsDirectory} from '../core/instructions/agents';
import { randomUUID } from 'node:crypto';
import type { ArtifactDiff, ProjectSummary, TaskArtifact, VerificationRecord } from '../../shared/contracts';
import { getDb } from './chat';

function withInstructions(project:ProjectSummary,authorized:boolean):ProjectSummary{
 if(!authorized||!fs.existsSync(project.rootPath)||fs.realpathSync(project.rootPath)!==project.rootPath)return {...project,authorized,rules:''};
 const source=readAgentsDirectory(project.rootPath,'project');
 return {...project,authorized,rules:source?.content||'',instructionPath:source?.path||path.join(project.rootPath,'AGENTS.md')};
}
export function listProjects(_agentId?: string): ProjectSummary[] {
  return (getDb().prepare(`SELECT p.id,p.name,p.memory,p.root_path AS rootPath,p.created_at AS createdAt,CASE WHEN a.enabled=1 THEN 1 ELSE 0 END AS authorized,p.previous_project_id AS previousProjectId FROM projects p LEFT JOIN project_authorizations a ON a.project_id=p.id ORDER BY p.created_at DESC,p.id`).all() as ProjectSummary[]).map(project=>withInstructions(project,Boolean(project.authorized)));
}
export function authorizeProject(projectId: string, enabled = true) {
  const project=getProject(projectId); if (!project) throw new Error('Project not found.');
  getDb().prepare('INSERT INTO project_authorizations(project_id,root_path,enabled) VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled').run(projectId,project.rootPath,enabled?1:0);
  if (!enabled) getDb().prepare('DELETE FROM session_approval_grants WHERE session_id IN (SELECT id FROM sessions WHERE project_id=?)').run(projectId);
}
export function isProjectAuthorized(projectId: string) { return Boolean(getDb().prepare('SELECT 1 FROM project_authorizations WHERE project_id=? AND enabled=1').get(projectId)); }
export function getProject(id: string): ProjectSummary | undefined {
  const project=getDb().prepare('SELECT id, name, memory, root_path AS rootPath, created_at AS createdAt, previous_project_id AS previousProjectId FROM projects WHERE id = ?').get(id) as ProjectSummary | undefined;
  return project?withInstructions(project,isProjectAuthorized(id)):undefined;
}

export function insertProject(name: string, rootPath: string, _agentId: string, previousProjectId?: string): ProjectSummary {
  return getDb().transaction(() => {
    const project = { id: randomUUID(), name, rootPath, createdAt: Date.now(), ...(previousProjectId ? { previousProjectId } : {}) };
    getDb().prepare('INSERT INTO projects (id, name, root_path, created_at, previous_project_id) VALUES (?, ?, ?, ?, ?)').run(project.id, name, rootPath, project.createdAt, previousProjectId || null);
    authorizeProject(project.id);
    return { ...project, authorized: true };
  })();
}

export function insertArtifact(artifact: Omit<TaskArtifact, 'id' | 'createdAt'>, oldText?: string, newText?: string) {
  const record: TaskArtifact = { ...artifact, id: randomUUID(), createdAt: Date.now() };
  getDb().prepare('INSERT INTO task_artifacts (id, run_id, session_id, data, old_text, new_text) VALUES (?, ?, ?, ?, ?, ?)').run(record.id, record.runId, record.sessionId, JSON.stringify(record), oldText ?? null, newText ?? null);
}

export function listArtifacts(sessionId: string): TaskArtifact[] {
  const rows = getDb().prepare('SELECT data FROM task_artifacts WHERE session_id = ? ORDER BY rowid DESC').all(sessionId) as Array<{ data: string }>;
  return rows.map((row) => JSON.parse(row.data) as TaskArtifact);
}

export function getArtifact(id: string): TaskArtifact | undefined {
  const row = getDb().prepare('SELECT data FROM task_artifacts WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? JSON.parse(row.data) as TaskArtifact : undefined;
}

export function getArtifactDiff(id: string): ArtifactDiff | undefined {
  const row = getDb().prepare('SELECT data, old_text, new_text FROM task_artifacts WHERE id = ?').get(id) as { data: string; old_text: string | null; new_text: string | null } | undefined;
  if (!row || row.old_text === null || row.new_text === null) return undefined;
  return { path: (JSON.parse(row.data) as TaskArtifact).path, oldText: row.old_text, newText: row.new_text };
}

export function insertVerification(record: Omit<VerificationRecord, 'id' | 'createdAt'>) {
  const value: VerificationRecord = { ...record, id: randomUUID(), createdAt: Date.now() };
  getDb().prepare('INSERT INTO verification_records (id, run_id, session_id, data) VALUES (?, ?, ?, ?)').run(value.id, value.runId, value.sessionId, JSON.stringify(value));
}

export function listVerifications(sessionId: string): VerificationRecord[] {
  const rows = getDb().prepare('SELECT data FROM verification_records WHERE session_id = ? ORDER BY rowid DESC').all(sessionId) as Array<{ data: string }>;
  return rows.map((row) => JSON.parse(row.data) as VerificationRecord);
}

export function renameProject(projectId: string, name: string) {
  getDb().prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, projectId);
}

export function updateProjectMemory(id: string,memory: string) { getDb().prepare('UPDATE projects SET memory=? WHERE id=?').run(memory,id); }
