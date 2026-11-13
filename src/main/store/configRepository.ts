import {readAgentsDirectory,writeAgentsFile} from '../core/instructions/agents';
import {defaultAgentsInstructions} from './configPromptTemplates';
import fs from 'fs';
import path from 'path';
import type { KairoPilotConfig } from '../../shared/contracts';
import { DEFAULT_CONFIG } from './configDefaults';
import { getConfigPath } from './configPaths';
import {
  normalizeConfig,
  sanitizeConfigForStorage
} from './configNormalization';
import { ensureWorkspaceDirectories, stripRuntimeInstructions } from './configWorkspace';
import { writeConfigAtomically } from './configFileIO';
import { prepareConfigSecret } from './configSecrets';

export interface KairoPilotConfigLoadResult {
  config: KairoPilotConfig;
  source: 'disk' | 'default';
  shouldPersist: boolean;
}

function cloneDefaultConfig(): KairoPilotConfig {
  return normalizeConfig(DEFAULT_CONFIG);
}

function readStoredConfig(configPath: string): KairoPilotConfig | undefined {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      const raw = JSON.parse(data) as {version?:string;workbench?:{version?:number}};
      if(raw.version!=='4.2.0'||raw.workbench?.version!==2)throw new Error('Unsupported configuration format. Use a fresh data directory.');
      return raw as KairoPilotConfig;
    }
  } catch (error) {
    console.error('Failed to load config:', error instanceof Error ? error.name : 'Invalid config');
    throw new Error('Unable to read configuration safely.');
  }

  return undefined;
}

export function loadKairoPilotConfigFromDisk(configPath: string = getConfigPath()): KairoPilotConfigLoadResult {
  const raw = readStoredConfig(configPath);
  return { config: raw ? normalizeConfig(raw) : cloneDefaultConfig(), source: raw ? 'disk' : 'default', shouldPersist: true };
}

/** Read and hydrate credentials without creating workspaces, backups or configuration files. */
export async function loadKairoPilotConfigFromDiskAsync(configPath: string = getConfigPath()): Promise<KairoPilotConfigLoadResult> {
  const raw = readStoredConfig(configPath);
  if (raw) {
    for (const provider of Object.values(raw.models?.providers || {})) await prepareConfigSecret(provider.apiKey, provider.apiKeyEncrypted);
    await prepareConfigSecret(raw.webSearch?.providers?.tavily?.apiKey, raw.webSearch?.providers?.tavily?.apiKeyEncrypted);
  }
  return { config: raw ? normalizeConfig(raw) : cloneDefaultConfig(), source: raw ? 'disk' : 'default', shouldPersist: true };
}

export function readKairoPilotConfig(configPath: string = getConfigPath()): KairoPilotConfig {
  return loadKairoPilotConfigFromDisk(configPath).config;
}

export function ensureKairoPilotConfigWorkspaces(config: KairoPilotConfig): KairoPilotConfig {
  const workbench = config.workbench!;
  ensureWorkspaceDirectories(workbench.managementRoot);
  return config;
}

export async function initializeKairoPilotConfig(): Promise<KairoPilotConfig> {
 const loaded=await loadKairoPilotConfigFromDiskAsync();
 ensureKairoPilotConfigWorkspaces(loaded.config);
 const instructionRoot=loaded.config.workbench!.instructionRoot!;
 if(!readAgentsDirectory(instructionRoot,'global'))writeAgentsFile(instructionRoot,defaultAgentsInstructions());
 if(loaded.shouldPersist)saveKairoPilotConfig(loaded.config);
 return loaded.config;
}

export function saveKairoPilotConfig(config: KairoPilotConfig) {
  const configPath = getConfigPath();
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const normalized = normalizeConfig(config);
    const sanitized = stripRuntimeInstructions(sanitizeConfigForStorage(normalized));
    writeConfigAtomically(configPath, JSON.stringify(sanitized, null, 2));
  } catch (error) {
    console.error('Failed to save config:', error);
    throw error;
  }
}

export {
  normalizeConfig,
  redactKairoPilotConfigSecrets,
  redactWebSearchConfig
} from './configNormalization';
