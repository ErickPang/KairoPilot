import { cancelActiveAgentRuntimes, clearAgentRuntimes } from '../assistant/agentRuntime';
import { recoverInterruptedRuns } from '../store/chat';
import { recoverIntelligenceWork } from '../store/intelligence';
import { recoverTaskQueue } from '../store/taskQueue';
import { createActiveAgentSession } from './chatService';
import { stopAllDelegatedTasks } from './delegationService';
import { stopAllProjectMemoryJobs } from './projectMemoryService';
import { hasLiveTaskExecution, setWorkbenchShuttingDown } from './workbenchExecution';

export function startApplicationConversation() {
  recoverInterruptedRuns();
  recoverIntelligenceWork();
  // Only process startup calls this; window reloads and tray restoration keep their selection.
  return createActiveAgentSession('New Chat');
}

export async function stopApplicationExecution() {
  setWorkbenchShuttingDown(true);
  try {
    recoverTaskQueue();
    stopAllDelegatedTasks();
    stopAllProjectMemoryJobs();
    await cancelActiveAgentRuntimes();
    // Give model/tool cancellation time to settle, including the shell's forced-kill fallback.
    const deadline = Date.now() + 5000;
    while (hasLiveTaskExecution() && Date.now() < deadline) {
      await cancelActiveAgentRuntimes();
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    recoverInterruptedRuns('RUN_INTERRUPTED_BY_EXIT: Application exited. Start a new conversation.');
    clearAgentRuntimes();
  } catch (error) {
    setWorkbenchShuttingDown(false);
    throw error;
  }
}
