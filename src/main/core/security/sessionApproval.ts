import { createHash } from 'node:crypto';
import type { SessionApprovalScope } from '../../../shared/contracts';
import { sessionCommandAction } from './sessionCommandApproval';

export interface SessionApprovalContext {
  workspaceRoot?: string;
  directoryForPath: (target: string, mode: 'read' | 'write') => string | undefined;
}

export interface SessionApprovalPolicy {
  allows: (key: string) => boolean;
  remember: (key: string, approvalId: string) => void;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  return value;
}

export function approvalFingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

export function sessionApprovalOperation(tool: string, args: Record<string, unknown>, context?: SessionApprovalContext): { key: string; scope: SessionApprovalScope } | undefined {
  const operation = (action: string, scope: SessionApprovalScope) => ({
    // A new namespace keeps old argument-specific grants from acquiring a broader meaning.
    key: approvalFingerprint(['session-action-v2', action, scope]), scope
  });
  if (tool === 'web_search') return operation('web-search', { kind: 'tool', target: tool });
  if (tool === 'fetch_webpage' || tool === 'http_request') {
    const method = tool === 'fetch_webpage' ? 'GET' : String(args.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method) || args.body !== undefined || args.json !== undefined || args.headers !== undefined) return undefined;
    try {
      const url = new URL(String(args.url));
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
      return operation(`${tool}:read`, { kind: 'origin', target: url.origin });
    } catch { return undefined; }
  }
  if (tool === 'execute_command') {
    const action = context && sessionCommandAction(args, context);
    return action ? operation('command', { kind: 'command', target: action }) : undefined;
  }
  const mode = ['read_file', 'list_directory', 'grep', 'glob'].includes(tool) ? 'read'
    : ['write_file', 'edit_file'].includes(tool) ? 'write' : undefined;
  if (mode && context) {
    const target = args.path || args.file_path || (['grep', 'glob'].includes(tool) ? context.workspaceRoot : undefined);
    if (typeof target !== 'string') return undefined;
    const root = context.directoryForPath(target, mode);
    return root ? operation(`files:${mode}`, { kind: 'directory', target: root }) : undefined;
  }
  // Unknown tools and executable skill scripts need individual review.
  return undefined;
}
