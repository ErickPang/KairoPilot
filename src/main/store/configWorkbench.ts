import path from 'node:path';
import type { KairoPilotConfig, WorkbenchConfig } from '../../shared/contracts';
import { getKairoPilotDataRoot } from '../services/dataRoot';
import { normalizeAgentPermissions } from './configPermissionUtils';

export const WORKBENCH_OWNER = 'workbench';
export function normalizeWorkbenchConfig(config: Partial<KairoPilotConfig>): WorkbenchConfig {
  const current = config.workbench;
  return {
    version: 2,
    defaultModel: current?.defaultModel || '',
    managementRoot: current?.managementRoot || path.join(getKairoPilotDataRoot(), 'workbench'),
    instructionRoot:getKairoPilotDataRoot(),
    permissions: normalizeAgentPermissions({ permissions: current?.permissions }),
    instructions: current?.instructions || '',
  };
}
