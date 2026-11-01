import {registerIntelligenceHandlers} from './intelligenceHandlers';
import {registerTaskQueueHandlers} from './taskQueueHandlers';
import {registerTaskWorkflowHandlers} from './taskWorkflowHandlers';
import { registerPluginHandlers } from './pluginHandlers';
import { registerSystemHandlers } from './systemHandlers';
import { registerConfigHandlers } from './configHandlers';
import { registerChatHandlers } from './chatHandlers';
import { registerAgentHandlers } from './agentHandlers';
import { registerWorkbenchHandlers } from './workbenchHandlers';

export function setupHandlers() {
  registerPluginHandlers();
  registerSystemHandlers();
  registerConfigHandlers();
  registerChatHandlers();
  registerAgentHandlers();
  registerWorkbenchHandlers();
  registerTaskWorkflowHandlers();
  registerIntelligenceHandlers();
  registerTaskQueueHandlers();
}
