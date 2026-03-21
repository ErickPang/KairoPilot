import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  sessionId?: string;
}

let store: Store<{ logs: AuditLogEntry[] }>;

function getStore(): Store<{ logs: AuditLogEntry[] }> {
  if (!store) {
    store = new Store<{ logs: AuditLogEntry[] }>({
      name: 'audit-logs',
      defaults: {
        logs: []
      }
    });
  }
  return store;
}

export function addAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>) {
  const logs = getStore().get('logs', []) as AuditLogEntry[];
  const newLog: AuditLogEntry = {
    id: uuidv4(),
    timestamp: Date.now(),
    ...entry
  };
  // Keep last 1000 logs
  if (logs.length > 1000) {
    logs.pop();
  }
  getStore().set('logs', [newLog, ...logs]);
}

export function getAuditLogs(limit = 100): AuditLogEntry[] {
  const logs = getStore().get('logs', []) as AuditLogEntry[];
  return logs.slice(0, limit);
}
