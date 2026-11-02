import type { ConversationActivity } from './contracts';

export function describeConversationTool(tool: string, args: Record<string, unknown>): ConversationActivity {
  const target = typeof args.path === 'string' ? args.path.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || '/' : '';
  if (tool === 'glob' || tool === 'list_directory') return { action: 'files', target: target || '.', icon: 'search' };
  if (tool === 'grep') return { action: 'search', target: [args.pattern, target].filter(Boolean).join(' · '), icon: 'search' };
  if (['read_file', 'read_attachment', 'read_skill_resource'].includes(tool)) return { action: 'read', target: target || String(args.name || args.resource || ''), icon: 'read' };
  if (['write_file', 'edit_file', 'delete_file'].includes(tool)) return { action: 'write', target, icon: 'tool' };
  if (tool === 'execute_command' || tool === 'run_skill_script') return { action: 'command', target: [args.command, ...(Array.isArray(args.args) ? args.args : [])].filter(value => typeof value === 'string').join(' '), icon: 'terminal' };
  if (['web_search', 'fetch_webpage', 'http_request'].includes(tool)) return { action: 'search', target: String(args.query || args.url || ''), icon: 'search' };
  return { action: 'tool', target: typeof args.name === 'string' ? `${tool} ${args.name}` : tool, icon: 'tool' };
}

// Extract user-facing output from the tool result envelope, without showing its internal fields.
export function conversationToolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(conversationToolOutput).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const result = value as Record<string, unknown>;
  for (const key of ['content', 'stdout', 'text', 'files', 'matches', 'results', 'data']) {
    const text = conversationToolOutput(result[key]);
    if (text) return [text, typeof result.stderr === 'string' ? result.stderr : ''].filter(Boolean).join('\n');
  }
  if (typeof result.path === 'string') return [result.path, result.lineNumber, result.line].filter(value => value !== undefined).join(':');
  return typeof result.error === 'string' ? result.error : '';
}
