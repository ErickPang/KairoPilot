import fs from 'fs';
import path from 'path';
import { redactPlainConfigSecrets } from './configSecrets';
import {
  normalizeConfig,
  sanitizeConfigForStorage
} from './configMigration';
import { stripAgentPromptFields } from './configWorkspace';

const MAX_CONFIG_BACKUPS = 5;

export function writeConfigAtomically(configPath: string, content: string) {
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf-8') : null;
  if (existing === content) {
    return;
  }

  if (existing !== null) {
    createConfigBackup(configPath, existing);
  }

  const tmpPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, configPath);
  pruneConfigBackups(configPath);
}

function createConfigBackup(configPath: string, content: string) {
  const backupPath = `${configPath}.backup-${Date.now()}`;
  fs.writeFileSync(backupPath, sanitizeExistingConfigBackup(content), 'utf-8');
}

function sanitizeExistingConfigBackup(content: string) {
  try {
    const normalized = normalizeConfig(JSON.parse(content));
    return JSON.stringify(stripAgentPromptFields(sanitizeConfigForStorage(normalized)), null, 2);
  } catch {
    return redactPlainConfigSecrets(content);
  }
}

function pruneConfigBackups(configPath: string) {
  const dir = path.dirname(configPath);
  const baseName = path.basename(configPath);
  const backups = fs.readdirSync(dir)
    .filter((fileName) => fileName.startsWith(`${baseName}.backup-`))
    .sort()
    .reverse();

  for (const staleBackup of backups.slice(MAX_CONFIG_BACKUPS)) {
    fs.unlinkSync(path.join(dir, staleBackup));
  }
}
