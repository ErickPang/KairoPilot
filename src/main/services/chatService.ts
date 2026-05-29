import {
  createSession,
  deleteSession,
  deleteSessionsByAgent,
  getActiveSession,
  getSessionById,
  listSessions,
  setActiveSessionId,
  updateSessionTitle
} from '../store/chat';
import { getActiveAgentId } from '../store/config';

export const ACTIVE_AGENT_SESSION_ERROR = 'Session does not belong to the active agent.';

function getScopedActiveAgentId() {
  return getActiveAgentId() || undefined;
}

export function getSessionForActiveAgent(sessionId: string) {
  const session = getSessionById(sessionId);
  const agentId = getActiveAgentId();
  if (!session || (agentId && session.agentId !== agentId)) {
    return null;
  }
  return session;
}

export function listActiveAgentSessions() {
  return listSessions(getScopedActiveAgentId());
}

export function createActiveAgentSession(title: string) {
  return createSession(title, getScopedActiveAgentId());
}

export function getActiveAgentSession() {
  return getActiveSession(getScopedActiveAgentId());
}

export function setActiveAgentSession(sessionId: string) {
  if (!getSessionForActiveAgent(sessionId)) {
    throw new Error(ACTIVE_AGENT_SESSION_ERROR);
  }
  setActiveSessionId(sessionId, getScopedActiveAgentId());
}

export function updateActiveAgentSessionTitle(sessionId: string, title: string) {
  if (!getSessionForActiveAgent(sessionId)) {
    throw new Error(ACTIVE_AGENT_SESSION_ERROR);
  }
  updateSessionTitle(sessionId, title);
}

export function deleteActiveAgentSession(sessionId: string) {
  if (!getSessionForActiveAgent(sessionId)) {
    throw new Error(ACTIVE_AGENT_SESSION_ERROR);
  }
  deleteSession(sessionId);
}

export function clearActiveAgentSessions() {
  deleteSessionsByAgent(getActiveAgentId());
}
