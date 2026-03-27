import { app } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface AppPaths {
  userDataPath: string;
  defaultWorkspacePath: string;
  defaultPluginsPath: string;
  publicSkillsPath: string;
  allowedProtocolRoots: string[];
}

export function ensureAppPaths(): AppPaths {
  const userDataPath = path.join(os.homedir(), '.kairopilot');
  const defaultWorkspacePath = path.join(userDataPath, 'workspace');
  const defaultPluginsPath = path.join(userDataPath, 'plugins');
  const publicSkillsPath = path.join(userDataPath, 'skills');

  for (const targetPath of [userDataPath, defaultWorkspacePath, defaultPluginsPath, publicSkillsPath]) {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
  }

  app.setPath('userData', userDataPath);

  return {
    userDataPath,
    defaultWorkspacePath,
    defaultPluginsPath,
    publicSkillsPath,
    allowedProtocolRoots: [
      userDataPath,
      defaultWorkspacePath,
      publicSkillsPath,
      defaultPluginsPath,
      app.getPath('temp')
    ].map((root) => path.resolve(root))
  };
}

function resolveBuiltinSkillsSourcePath() {
  const candidatePaths = app.isPackaged
    ? [path.join(process.resourcesPath, 'builtin-skills')]
    : [
        path.join(process.cwd(), 'skills'),
        path.join(app.getAppPath(), 'skills'),
        process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT, '..', 'skills') : ''
      ].filter(Boolean);

  for (const candidatePath of candidatePaths) {
    if (candidatePath && fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

export async function seedBuiltinSkills(appPaths: AppPaths) {
  const sourceDir = resolveBuiltinSkillsSourcePath();
  if (!sourceDir) {
    console.warn('[Skills] Builtin skills source directory not found, skipping seed.');
    return 0;
  }

  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  let installedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }

    const sourceSkillDir = path.join(sourceDir, entry.name);
    const targetSkillDir = path.join(appPaths.publicSkillsPath, entry.name);
    const sourceSkillFile = path.join(sourceSkillDir, 'SKILL.md');

    try {
      const sourceStat = await fsp.stat(sourceSkillFile);
      if (!sourceStat.isFile() || fs.existsSync(targetSkillDir)) {
        continue;
      }

      await fsp.cp(sourceSkillDir, targetSkillDir, {
        recursive: true,
        force: false,
        errorOnExist: false
      });
      installedCount += 1;
    } catch {
      continue;
    }
  }

  if (installedCount > 0) {
    console.log(`[Skills] Seeded ${installedCount} builtin skills into ${appPaths.publicSkillsPath}`);
  }

  return installedCount;
}
