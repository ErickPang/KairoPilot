import os from 'os';
import path from 'path';
import {
  createDefaultAgentPermissions,
  DEFAULT_SKILL_MARKETPLACE_PRESETS,
  type AgentConfig,
  type KairoPilotConfig
} from '../../shared/contracts';
import { buildDefaultIdentityTemplate, buildDefaultKairopilotTemplate, buildDefaultSoulTemplate, buildDefaultUserTemplate } from './configPromptTemplates';
import { createDefaultWebSearchConfig } from './configWebSearchUtils';

const defaultWorkspace = path.join(os.homedir(), '.kairopilot', 'workspace');

export const DEFAULT_AGENT: AgentConfig = {
  id: 'mainAgent',
  name: 'main',
  workspace: defaultWorkspace,
  systemPrompt: buildDefaultKairopilotTemplate({
    name: 'main',
    workspace: defaultWorkspace
  }),
  identityPrompt: buildDefaultIdentityTemplate(),
  userPrompt: buildDefaultUserTemplate(),
  soulPrompt: buildDefaultSoulTemplate(),
  model: '',
  permissions: createDefaultAgentPermissions()
};

export const DEFAULT_CONFIG: KairoPilotConfig = {
  version: '3.1.0',
  models: {
    providers: {}
  },
  agents: {
    activeAgentId: DEFAULT_AGENT.id,
    list: [DEFAULT_AGENT]
  },
  plugins: {
    registry: []
  },
  skills: {
    registry: DEFAULT_SKILL_MARKETPLACE_PRESETS.map((preset) => ({
      type: preset.type,
      url: preset.url,
      name: preset.name
    }))
  },
  appearance: {
    theme: 'system'
  },
  webSearch: createDefaultWebSearchConfig()
};
