import { getDb } from './chat';
import type { SessionApprovalPolicy } from '../core/security/sessionApproval';

export function sessionApprovalPolicy(sessionId: string, context: string): SessionApprovalPolicy {
  return {
    allows(key) {
      return Boolean(getDb().prepare('SELECT 1 FROM session_approval_grants WHERE session_id=? AND context=? AND operation=?').get(sessionId, context, key));
    },
    remember(key, approvalId) {
      const db = getDb();
      db.transaction(() => {
        const approval = db.prepare("SELECT metadata FROM approval_records WHERE id=? AND session_id=? AND status='approved'").get(approvalId, sessionId) as { metadata: string | null } | undefined;
        if (!approval) throw new Error('Session permission requires an approved operation from this conversation.');
        db.prepare('INSERT OR REPLACE INTO session_approval_grants(session_id,context,operation,approval_id) VALUES(?,?,?,?)').run(sessionId, context, key, approvalId);
        db.prepare('UPDATE approval_records SET metadata=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(approval.metadata || '{}'), decisionScope: 'session' }), approvalId);
      })();
    }
  };
}

export function clearSessionApprovalGrants(sessionId?: string) {
  if (sessionId) getDb().prepare('DELETE FROM session_approval_grants WHERE session_id=?').run(sessionId);
  else getDb().prepare('DELETE FROM session_approval_grants').run();
}
