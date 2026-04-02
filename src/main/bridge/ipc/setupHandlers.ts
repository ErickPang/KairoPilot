import { registerPluginHandlers } from './pluginHandlers';
import { registerSystemHandlers } from './systemHandlers';
import { registerConfigHandlers } from './configHandlers';
import { registerChatHandlers } from './chatHandlers';
import { registerAgentHandlers } from './agentHandlers';

export function setupHandlers() {
  registerPluginHandlers();
  registerSystemHandlers();
  registerConfigHandlers();
  registerChatHandlers();
  registerAgentHandlers();
}
