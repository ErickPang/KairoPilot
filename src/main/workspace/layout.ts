import path from 'path';

export interface PromptWorkspaceLayout {
  workspaceRoot: string;
  promptsDir: string;
  memoryDir: string;
  skillsDir: string;
  tasksDir: string;
  artifactsDir: string;
  imagesDir: string;
  mediaDir: string;
  memoryFile: string;
}

export function getPromptWorkspaceLayout(workspace: string): PromptWorkspaceLayout {
  return {
    workspaceRoot: workspace,
    promptsDir: path.join(workspace, 'prompts'),
    memoryDir: path.join(workspace, 'memory'),
    skillsDir: path.join(workspace, 'skills'),
    tasksDir: path.join(workspace, 'tasks'),
    artifactsDir: path.join(workspace, 'artifacts'),
    imagesDir: path.join(workspace, 'images'),
    mediaDir: path.join(workspace, 'media'),
    memoryFile: path.join(workspace, 'MEMORY.md')
  };
}
