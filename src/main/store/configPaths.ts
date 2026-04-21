import { app } from 'electron';
import os from 'os';
import path from 'path';

export function normalizeWorkspaceName(value: string) {
  return value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
}

export function buildAgentWorkspacePath(agentId: string, workspaceName?: string) {
  if (agentId === 'mainAgent') {
    return path.join(os.homedir(), '.kairopilot', 'workspace');
  }

  return workspaceName
    ? path.join(os.homedir(), '.kairopilot', `workspace-${workspaceName}`)
    : path.join(os.homedir(), '.kairopilot', 'workspace');
}

export function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'kairopilot.json');
}
