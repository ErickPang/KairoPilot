import { getOwnedSessionSummary, getActiveSessionSummary, querySessionPage } from '../store/taskPages';
import { getDb,createSession,deleteSession,getSessionById,setActiveSessionId,updateSessionTitle } from '../store/chat';
import { contextForProjectSession } from './projectService';
import { assertTaskMutable } from './workbenchExecution';
import { initializeIndependentDirectory,newTaskSettings } from './taskSettingsService';
import { WORKBENCH_OWNER } from '../store/configWorkbench';
import {revokePluginConnections} from '../core/plugins/connectionManager';
export const ACTIVE_AGENT_SESSION_ERROR='Task not found in this workbench.';
export function getSessionForActiveAgent(sessionId: string) { return getOwnedSessionSummary(undefined,sessionId); }
export function listActiveAgentSessions() { return querySessionPage(undefined,{filter:'all',limit:100}).items; }
export function createActiveAgentSession(title: string,projectId?: string) {
  const session=createSession(title,WORKBENCH_OWNER,{...contextForProjectSession(projectId),executionSettings:newTaskSettings()});
  if(!projectId)initializeIndependentDirectory(session.id);
  setActiveSessionId(session.id,WORKBENCH_OWNER);return getSessionById(session.id)!;
}
export function getActiveAgentSession() { const task=getActiveSessionSummary(undefined);return task?getSessionById(task.id):null; }
export function setActiveAgentSession(sessionId: string) {
  if(!getSessionForActiveAgent(sessionId))throw new Error(ACTIVE_AGENT_SESSION_ERROR);
  setActiveSessionId(sessionId,WORKBENCH_OWNER);
}
export function updateActiveAgentSessionTitle(sessionId: string,title: string) { if(!getSessionForActiveAgent(sessionId))throw new Error(ACTIVE_AGENT_SESSION_ERROR);updateSessionTitle(sessionId,title); }
export function deleteActiveAgentSession(sessionId: string) { if(!getSessionForActiveAgent(sessionId))throw new Error(ACTIVE_AGENT_SESSION_ERROR);assertTaskMutable(sessionId);revokePluginConnections(sessionId);deleteSession(sessionId); }
export function clearActiveAgentSessions() { const tasks=getDb().prepare('SELECT id FROM sessions').all() as Array<{id:string}>;tasks.forEach(task=>assertTaskMutable(task.id));revokePluginConnections();tasks.forEach(task=>deleteSession(task.id)); }
