import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AppPaths {
  userDataPath: string;
  defaultWorkspacePath: string;
  defaultPluginsPath: string;
  allowedProtocolRoots: string[];
}

export function ensureAppPaths(): AppPaths {
  const userDataPath = path.join(os.homedir(), '.kairopilot');
  const defaultWorkspacePath = path.join(userDataPath, 'workspace');
  const defaultPluginsPath = path.join(userDataPath, 'plugins');

  for (const targetPath of [userDataPath, defaultWorkspacePath, defaultPluginsPath]) {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
  }

  app.setPath('userData', userDataPath);

  return {
    userDataPath,
    defaultWorkspacePath,
    defaultPluginsPath,
    allowedProtocolRoots: [
      userDataPath,
      defaultWorkspacePath,
      defaultPluginsPath,
      app.getPath('temp')
    ].map((root) => path.resolve(root))
  };
}
