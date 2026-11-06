import { getKairoPilotDataRoot } from '../services/dataRoot';
import path from 'path';
import {
  createDefaultAgentPermissions,
  DEFAULT_SKILL_MARKETPLACE_PRESETS,
  type KairoPilotConfig
} from '../../shared/contracts';

import { createDefaultWebSearchConfig } from './configWebSearchUtils';

const managementRoot = path.join(getKairoPilotDataRoot(), 'workbench');

export const DEFAULT_CONFIG: KairoPilotConfig = {
  version: '4.2.0',
  workbench: {version:2,defaultModel:'',managementRoot,instructionRoot:getKairoPilotDataRoot(),instructions:'',permissions:createDefaultAgentPermissions()},
  models: {
    providers: {}
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
