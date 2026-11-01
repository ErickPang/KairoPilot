import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AgentConfig, RunExecutionContext } from '../../../shared/contracts';
import { PermissionGuard } from './permissions';

export function createAgentPermissionGuard(agent: AgentConfig, executionRoot?: string) {
  return new PermissionGuard({
    ...agent.permissions,
    fileSystem: {
      ...agent.permissions.fileSystem,
      read: agent.permissions.executionProfile !== 'chat_only' && agent.permissions.fileSystem.read,
      write: agent.permissions.executionProfile !== 'chat_only' && agent.permissions.executionProfile !== 'read_only_workspace' && agent.permissions.fileSystem.write,
      allowedPaths: executionRoot ? [executionRoot] : [...new Set([agent.workspace, ...agent.permissions.fileSystem.allowedPaths])]
    }
  });
}

export function canonicalDirectory(root: string): string {
  if (!path.isAbsolute(root)) throw new Error('An absolute directory is required.');
  const canonical = fs.realpathSync(root);
  if (!fs.statSync(canonical).isDirectory()) throw new Error('Execution directory is not a directory.');
  return canonical;
}

export function assertExecutionDirectory(agent: AgentConfig, root: string): string {
  const canonical = canonicalDirectory(root);
  const guard = createAgentPermissionGuard(agent);
  const isOwnWorkspace = canonical === canonicalDirectory(agent.workspace);
  if (!guard.checkFileSystem(canonical, 'read') && !guard.checkFileSystem(canonical, 'write') && !(isOwnWorkspace && agent.permissions.executionProfile === 'chat_only')) {
    throw new Error('The execution directory is outside the agent’s current permissions. Configure permissions explicitly before binding it.');
  }
  return canonical;
}

export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function guardForExecution(agent: AgentConfig, context?: RunExecutionContext) {
  if (!context) return createAgentPermissionGuard(agent);
  if(context.version!==2)throw new Error('Unsupported execution snapshot. Start a new task.');
  const canonical = canonicalDirectory(context.executionRoot);
  if (canonical !== context.executionRoot) throw new Error('The recorded execution directory was moved or redirected. Start a new task.');
  return createAgentPermissionGuard(agent, canonical);
}
