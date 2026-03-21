import { ipcMain, dialog } from 'electron';
import { AgentRuntime } from '../core/agent/runtime';
import { OpenAIProvider } from '../core/llm/provider';
import { PromptBuilder } from '../core/llm/prompt';
import { PermissionGuard } from '../core/security/permissions';
import { ReadFileTool, WriteFileTool, ListDirectoryTool, DeleteFileTool } from '../core/tools/filesystem';
import { createExecuteCommandTool } from '../core/tools/shell';
import { SystemInfoTool } from '../core/tools/system';
import { WebSearchTool, FetchWebpageTool } from '../core/tools/web';
import path from 'path';
import { 
  getAgentConfig, 
  saveAgentConfig, 
  getKairoPilotConfig,
  getModels,
  saveModel,
  deleteModel,
  getAgents,
  saveAgent,
  deleteAgent,
  setActiveAgentId,
  getActiveAgentId,
  getAgent,
  getModel,
  AgentConfig,
  ModelConfig
} from '../store/config';
import { createSession, getActiveSession, updateSessionMessages, updateSessionTitle, deleteSession, clearAllSessions, setActiveSessionId, getSessions, getAgentStats } from '../store/chat';
import { addAuditLog, getAuditLogs } from '../store/audit';
import os from 'os';
import { spawn } from 'child_process';
import { z } from 'zod';

import { v4 as uuidv4 } from 'uuid';
import { WebContents } from 'electron';

let currentAgent: AgentRuntime | null = null;
const pendingConfirmations = new Map<string, (approved: boolean) => void>();

interface ResolvedAgentConfig {
  agent: AgentConfig;
  model: ModelConfig;
}

async function initializeAgent(config: ResolvedAgentConfig, sender?: WebContents) {
  // Agent initialization logs removed to prevent sensitive info (like apiKey) from being printed
      
  // No longer saving config on init - separation of concerns
  // saveAgentConfig(config);

  const { agent, model } = config;

  // Create PermissionGuard
  // In a real app, permissions should be loaded from a secure store, not passed from frontend directly
  // But for MVP, we allow frontend to specify workspace
  const workspace = agent.workspace ? path.resolve(agent.workspace) : process.cwd();
  
  // Combine workspace with user-provided allowed paths
  const userAllowedPaths = Array.isArray(agent.allowedPaths) 
    ? agent.allowedPaths.filter((p: string) => p && p.trim().length > 0).map((p: string) => path.resolve(p))
    : [];
  
  const allowedPaths = [...new Set([workspace, ...userAllowedPaths])];

  // Combine default shell commands with user-provided allowed commands
  const defaultCommands = ['ls', 'cd', 'pwd', 'mkdir', 'rm', 'touch', 'cat', 'grep', 'echo', 'npm', 'node', 'git', 'python', 'python3', 'open', 'curl'];
  const userAllowedCommands = Array.isArray(agent.allowedCommands)
    ? agent.allowedCommands.filter((c: string) => c && c.trim().length > 0)
    : [];

  // If user provides custom commands, use them. Otherwise use default if shell is enabled.
  const allowedCommands = userAllowedCommands.length > 0 ? userAllowedCommands : defaultCommands;

  const permissions = new PermissionGuard({
    fileSystem: {
      read: true,
      write: true,
      allowedPaths: allowedPaths,
    },
    network: {
      enabled: true,
      allowedDomains: [], // Allow all
    },
    shell: {
      enabled: agent.enableShell || false,
      allowedCommands: agent.enableShell ? allowedCommands : [],
    },
  });

  // Create LLM Provider
  const llm = new OpenAIProvider({
    provider: model.provider || 'openai',
    apiKey: model.apiKey,
    baseUrl: model.baseUrl,
    model: model.model || 'gpt-3.5-turbo',
  });

  // Create Agent Prompt using PromptBuilder
  const systemPromptWithContext = PromptBuilder.buildSystemPrompt({
    workspace: workspace,
    agentPrompt: agent.systemPrompt
  });

  currentAgent = new AgentRuntime(llm, permissions, systemPromptWithContext, async (toolName, args) => {
    if (!sender) {
      console.warn('No sender available for confirmation, auto-denying.');
      return false;
    }
    
    const confirmationId = uuidv4();
    return new Promise<boolean>((resolve) => {
       pendingConfirmations.set(confirmationId, resolve);
       sender.send('agent:ask-confirmation', { id: confirmationId, tool: toolName, args });
     });
   },
   (log) => {
      addAuditLog({
        tool: log.tool,
        args: log.args,
        result: log.result,
        error: log.error,
        sessionId: getActiveSession()?.id
      });
   });
   
  // Register Tools
  currentAgent.registerTool(ReadFileTool as any);
  currentAgent.registerTool(WriteFileTool as any);
  currentAgent.registerTool(ListDirectoryTool as any);
  currentAgent.registerTool(DeleteFileTool as any);
  currentAgent.registerTool(createExecuteCommandTool(workspace) as any);
  currentAgent.registerTool(SystemInfoTool as any);
  currentAgent.registerTool(WebSearchTool as any);
  currentAgent.registerTool(FetchWebpageTool as any);

  // Load and register dynamic plugins
  try {
    const dynamicTools = await pluginManager.loadAllTools(agent.id);
    for (const tool of dynamicTools) {
      currentAgent.registerTool(tool as any);
      console.log(`[Agent] Registered dynamic tool: ${tool.name}`);
    }
  } catch (error) {
    console.error('Failed to load dynamic plugins:', error);
  }

  // Load and register Agent Skills (SKILL.md) as Tools
  try {
    const agentSkills = await pluginManager.getMergedSkillsForAgent(agent.id);
    for (const skill of agentSkills) {
      const skillTool = {
        name: `skill_${skill.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        description: `Use this skill when you need to: ${skill.description}. Calling this will return the standard operating procedure (SOP) or instructions.`,
        parameters: z.object({}), // no parameters needed
        execute: async () => {
          return `[SKILL INSTRUCTIONS: ${skill.name}]\n\n${skill.content}`;
        }
      };
      currentAgent.registerTool(skillTool as any);
      console.log(`[Agent] Registered skill tool: ${skillTool.name} (Source: ${skill.source})`);
    }
  } catch (error) {
    console.error('Failed to load agent skills:', error);
  }
  
  return true;
}

let previousCpus = os.cpus();

  // Helper to resolve config from ID or object
  async function resolveAgentConfig(configOrId: any): Promise<ResolvedAgentConfig> {
    if (typeof configOrId === 'string') {
      const agent = getAgent(configOrId);
      if (!agent) throw new Error(`Agent with ID ${configOrId} not found`);
      
      const model = getModel(agent.modelConfigId);
      // If model not found, maybe use default or throw?
      // For robustness, if model missing, use a dummy one to avoid crash, but warn.
      const resolvedModel = model || { 
        id: 'dummy',
        name: 'Dummy Model',
        provider: 'openai', 
        apiKey: '', 
        baseUrl: '', 
        model: 'gpt-3.5-turbo' 
      };
      
      return { agent, model: resolvedModel };
    }
    
    // If passed a full ResolvedAgentConfig object (unlikely but possible for testing)
    if (configOrId && configOrId.agent && configOrId.model) {
      return configOrId;
    }
    
    // Fallback for legacy calls or malformed data - try to reconstruct or fail
    throw new Error("Invalid configuration provided to resolveAgentConfig");
  }

import { pluginManager } from '../core/plugins/manager';

export function setupHandlers() {
  // --- Plugin Store Handlers ---
  ipcMain.handle('plugins:getStore', async () => {
    return pluginManager.getStorePlugins();
  });

  ipcMain.handle('plugins:getInstalled', async () => {
    return pluginManager.getInstalledPlugins();
  });

  ipcMain.handle('plugins:install', async (_, args) => {
    try {
      const id = typeof args === 'string' ? args : args.id;
      const scope = typeof args === 'string' ? 'public' : (args.scope || 'public');
      await pluginManager.installPlugin(id, scope);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('plugins:uninstall', async (_, args) => {
    try {
      const id = typeof args === 'string' ? args : args.id;
      const scope = typeof args === 'string' ? 'public' : (args.scope || 'public');
      await pluginManager.uninstallPlugin(id, scope);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('system:stats', async () => {
    const currentCpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const uptime = os.uptime();
    
    // Calculate CPU usage
    let totalIdle = 0;
    let totalTick = 0;

    currentCpus.forEach((cpu, i) => {
      const prevCpu = previousCpus[i];
      if (prevCpu) {
        let type: keyof typeof cpu.times;
        for (type in cpu.times) {
          totalTick += cpu.times[type] - prevCpu.times[type];
        }
        totalIdle += cpu.times.idle - prevCpu.times.idle;
      }
    });

    const cpuUsage = totalTick > 0 ? Math.round(((totalTick - totalIdle) / totalTick) * 100) : 0;
    previousCpus = currentCpus;

    return {
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: currentCpus[0]?.model || 'Unknown',
      cpuUsage: cpuUsage,
      memoryUsage: Math.round(((totalMem - freeMem) / totalMem) * 100),
      totalMemory: (totalMem / (1024 * 1024 * 1024)).toFixed(1),
      uptime: Math.floor(uptime / 3600)
    };
  });

  ipcMain.handle('system:selectDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (canceled) {
      return null;
    } else {
      return filePaths[0];
    }
  });

  ipcMain.handle('config:get', async () => {
    return getAgentConfig();
  });

  ipcMain.handle('config:save', async (_, config) => {
    saveAgentConfig(config);
    return { success: true };
  });

  // Chat History Handlers
  ipcMain.handle('chat:getSessions', async () => {
    // Return full sessions to maintain frontend compatibility
    // In future, this should be paginated or lazy-loaded
    const agentId = getActiveAgentId();
    return getSessions(agentId || undefined);
  });

  ipcMain.handle('chat:createSession', async (_, title) => {
    // If title is string, use it. If it's an event (shouldn't be), default to 'New Chat'
    const sessionTitle = typeof title === 'string' ? title : 'New Chat';
    const agentId = getActiveAgentId();
    return createSession(sessionTitle, agentId || undefined);
  });

  ipcMain.handle('chat:getActiveSession', async () => {
    return getActiveSession();
  });

  ipcMain.handle('chat:setActiveSession', async (_, sessionId) => {
    setActiveSessionId(sessionId);
    return { success: true };
  });

  ipcMain.handle('chat:updateSessionTitle', async (_, { sessionId, title }) => {
    updateSessionTitle(sessionId, title);
    return { success: true };
  });

  ipcMain.handle('chat:deleteSession', async (_, sessionId) => {
    deleteSession(sessionId);
    return { success: true };
  });

  ipcMain.handle('chat:clearAllSessions', async () => {
    clearAllSessions();
    return { success: true };
  });

  ipcMain.handle('chat:getAgentStats', async () => {
    return getAgentStats();
  });

  ipcMain.handle('llm:listModels', async (_, config) => {
    try {
      const llm = new OpenAIProvider({
        provider: config.provider || 'openai',
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: 'dummy', // Model not needed for listing
      });
      return await llm.listModels();
    } catch (error: any) {
      console.warn(`[Handlers] Failed to list models: ${error.message}`);
      return [];
    }
  });

  // --- Ollama Specific Handlers ---
  ipcMain.handle('ollama:check', async (_, baseUrl: string) => {
    try {
      const url = baseUrl || 'http://localhost:11434';
      const response = await fetch(url);
      if (response.ok) {
        return { running: true, message: await response.text() };
      }
      return { running: false, error: `HTTP Status: ${response.status}` };
    } catch (error: any) {
      return { running: false, error: error.message };
    }
  });

  ipcMain.handle('ollama:start', async () => {
    return new Promise((resolve) => {
      // Spawn ollama serve in detached mode
      const child = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      
      child.on('error', (err: any) => {
        resolve({ success: false, error: err.message });
      });

      child.unref(); // Let it run independently
      
      // Wait a moment for it to start
      setTimeout(() => {
        resolve({ success: true });
      }, 2000);
    });
  });

  ipcMain.handle('ollama:pull', async (event, { baseUrl, modelName }) => {
    try {
      const url = `${baseUrl || 'http://localhost:11434'}/api/pull`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });

      if (!response.ok) {
        return { success: false, error: `Failed to pull: ${response.statusText}` };
      }

      if (!response.body) {
        return { success: false, error: 'No response body' };
      }

      // Stream the response to the renderer
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            event.sender.send('ollama:pull-progress', data);
          } catch (e) {
            // Ignore parse errors for partial chunks
          }
        }
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // --- New Config Management Handlers ---

  ipcMain.handle('config:get-all', async () => {
    return getKairoPilotConfig();
  });

  ipcMain.handle('config:get-models', async () => {
    return getModels();
  });
  
  ipcMain.handle('config:save-model', async (_, model) => {
    saveModel(model);
    return { success: true };
  });

  ipcMain.handle('config:delete-model', async (_, id) => {
    deleteModel(id);
    return { success: true };
  });

  ipcMain.handle('config:get-agents', async () => {
    return getAgents();
  });

  ipcMain.handle('config:save-agent', async (_, agent) => {
    saveAgent(agent);
    return { success: true };
  });
  
  ipcMain.handle('config:delete-agent', async (_, id) => {
    deleteAgent(id);
    return { success: true };
  });

  ipcMain.handle('config:set-active-agent', async (_, id) => {
    setActiveAgentId(id);
    return { success: true };
  });

  ipcMain.handle('config:get-active-agent-id', async () => {
    return getActiveAgentId();
  });

  // Updated agent:init to support ID or Config Object
  ipcMain.handle('agent:init', async (event, configOrId) => {
    try {
      const config = await resolveAgentConfig(configOrId);
      
      // If it was an ID (switching agent), set it as active
      if (typeof configOrId === 'string') {
        setActiveAgentId(configOrId);

        // Switch to most recent session for this agent, or create new one
        const agentSessions = getSessions(configOrId);
        if (agentSessions.length > 0) {
          setActiveSessionId(agentSessions[0].id);
        } else {
          createSession('New Chat', configOrId);
        }
      }
      
      await initializeAgent(config, event.sender);
      return { success: true };
    } catch (error: any) {
      console.error('Failed to init agent:', error);
      return { success: false, error: error.message };
    }
  });


  ipcMain.handle('agent:confirm-response', async (_, { id, approved }) => {
    const resolve = pendingConfirmations.get(id);
    if (resolve) {
      resolve(approved);
      pendingConfirmations.delete(id);
    }
    return { success: true };
  });

  ipcMain.handle('audit:get', async (_, limit) => {
    return getAuditLogs(limit);
  });

  ipcMain.handle('agent:chat', async (event, message) => {
    if (!currentAgent) {
      // Try to re-initialize from config if possible, or fail
      try {
        const activeAgentId = getActiveAgentId();
        if (activeAgentId) {
          const config = await resolveAgentConfig(activeAgentId);
          await initializeAgent(config, event.sender);
        } else {
           return { error: 'Agent not initialized. Please configure settings first.' };
        }
      } catch (e) {
         return { error: 'Agent not initialized. Please configure settings first.' };
      }
    }

    if (!currentAgent) {
       return { error: 'Agent initialization failed.' };
    }

    try {
      // 1. Ensure active session
      let session = getActiveSession();
      if (!session) {
        session = createSession();
      }

      // 2. Load history from session
      // Always sync from session before chat to ensure continuity
      currentAgent.setHistory(session.messages);

      // Pass a callback to receive updates from the agent
      const response = await currentAgent.chat(message, (update) => {
        event.sender.send('agent:update', update);
      });

      // 3. Save updated history to session
      updateSessionMessages(session.id, currentAgent.getHistory());

      return { content: response };
    } catch (error: any) {
      return { error: error.message };
    }
  });
}
