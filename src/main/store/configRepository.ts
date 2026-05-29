import fs from 'fs';
import path from 'path';
import type { KairoPilotConfig } from '../../shared/contracts';
import { DEFAULT_CONFIG } from './configDefaults';
import { getConfigPath } from './configPaths';
import {
  normalizeConfig,
  sanitizeConfigForStorage
} from './configMigration';
import { ensureAgentWorkspaceAndPrompt, stripAgentPromptFields } from './configWorkspace';
import { writeConfigAtomically } from './configFileIO';

export interface KairoPilotConfigLoadResult {
  config: KairoPilotConfig;
  source: 'disk' | 'default';
  shouldPersist: boolean;
}

function cloneDefaultConfig(): KairoPilotConfig {
  return normalizeConfig(DEFAULT_CONFIG);
}

export function loadKairoPilotConfigFromDisk(configPath: string = getConfigPath()): KairoPilotConfigLoadResult {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      return {
        config: normalizeConfig(JSON.parse(data)),
        source: 'disk',
        shouldPersist: true
      };
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }

  return {
    config: cloneDefaultConfig(),
    source: 'default',
    shouldPersist: true
  };
}

export function readKairoPilotConfig(configPath: string = getConfigPath()): KairoPilotConfig {
  return loadKairoPilotConfigFromDisk(configPath).config;
}

export function ensureKairoPilotConfigWorkspaces(config: KairoPilotConfig): KairoPilotConfig {
  config.agents.list.forEach(ensureAgentWorkspaceAndPrompt);
  return config;
}

export function persistKairoPilotConfigMigrations(config: KairoPilotConfig) {
  saveKairoPilotConfig(config);
}

export function initializeKairoPilotConfig(): KairoPilotConfig {
  const loaded = loadKairoPilotConfigFromDisk();
  ensureKairoPilotConfigWorkspaces(loaded.config);
  if (loaded.shouldPersist) {
    persistKairoPilotConfigMigrations(loaded.config);
  }
  return loaded.config;
}

/**
 * @deprecated Use readKairoPilotConfig for side-effect-free reads or initializeKairoPilotConfig during app bootstrap.
 */
export function getKairoPilotConfig(): KairoPilotConfig {
  return initializeKairoPilotConfig();
}

export function saveKairoPilotConfig(config: KairoPilotConfig) {
  const configPath = getConfigPath();
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const normalized = normalizeConfig(config);
    const sanitized = stripAgentPromptFields(sanitizeConfigForStorage(normalized));
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
} from './configMigration';
