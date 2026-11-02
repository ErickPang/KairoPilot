import {
  getApprovalRecord,
  getLatestRun,
  getPendingApproval
} from '../store/chat';
import { getSessionForActiveAgent } from './chatService';

export function getLatestRunForActiveAgentSession(sessionId: string) {
  if (!getSessionForActiveAgent(sessionId)) {
    return null;
  }
  return getLatestRun(sessionId);
}

export function getPendingApprovalForActiveAgentSession(sessionId?: string) {
  if (sessionId) {
    if (!getSessionForActiveAgent(sessionId)) {
      return null;
    }
    return getPendingApproval(sessionId);
  }

  const approval = getPendingApproval();
  if (!approval?.id) {
    return null;
  }
  return getApprovalRecord(approval.id);
}
