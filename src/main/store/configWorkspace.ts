import fs from 'fs';
import path from 'path';
import type { AgentConfig, KairoPilotConfig } from '../../shared/contracts';
import { getPromptWorkspaceLayout } from '../workspace/layout';
import { AGENT_FILE_NAMES, ensureAgentPromptFields } from './configPromptTemplates';

export function ensureAgentWorkspaceAndPrompt(agent: AgentConfig) {
  if (!agent.workspace) {
    return;
  }
  try {
    const layout = getPromptWorkspaceLayout(agent.workspace);
    if (!fs.existsSync(layout.workspaceRoot)) {
      fs.mkdirSync(layout.workspaceRoot, { recursive: true });
    }
    const workspaceDirectories = [
      layout.promptsDir,
      layout.memoryDir,
      layout.skillsDir,
      layout.tasksDir,
      layout.artifactsDir,
      layout.imagesDir,
      layout.mediaDir
    ];
    for (const directoryPath of workspaceDirectories) {
      if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
      }
    }
    ensureAgentPromptFields(agent);
    const promptFiles: Array<{ fileName: string; content: string }> = [
      { fileName: AGENT_FILE_NAMES.kairopilot, content: agent.systemPrompt },
      { fileName: AGENT_FILE_NAMES.identity, content: agent.identityPrompt },
      { fileName: AGENT_FILE_NAMES.user, content: agent.userPrompt },
      { fileName: AGENT_FILE_NAMES.soul, content: agent.soulPrompt }
    ];
    for (const item of promptFiles) {
      const filePath = path.join(agent.workspace, item.fileName);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, item.content, 'utf-8');
        continue;
      }
      const existing = fs.readFileSync(filePath, 'utf-8');
      if (!existing.trim()) {
        fs.writeFileSync(filePath, item.content, 'utf-8');
      }
    }
  } catch (e) {
    console.error(`Failed to initialize workspace for agent ${agent.id}:`, e);
  }
}

export function stripAgentPromptFields(config: KairoPilotConfig): KairoPilotConfig {
  const sanitizedAgents = config.agents.list.map(agent => {
    const { systemPrompt, identityPrompt, userPrompt, soulPrompt, ...rest } = agent;
    void systemPrompt;
    void identityPrompt;
    void userPrompt;
    void soulPrompt;
    return rest as AgentConfig;
  });
  return {
    ...config,
    agents: {
      ...config.agents,
      list: sanitizedAgents
    }
  };
}
